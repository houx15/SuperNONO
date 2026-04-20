//! Native microphone capture via cpal.
//!
//! Tauri 2's WKWebView on macOS doesn't expose `navigator.mediaDevices`, so
//! the browser AudioWorklet path from M2 is unreachable. We run cpal on the
//! Rust side instead, downsample to 16 kHz / int16 / mono in the audio
//! callback, and emit `mic://chunk` (PCM bytes) and `mic://rms` (float 0..1)
//! events up to TS. The `MicCapture` TS class subscribes to these events and
//! implements the same `MicCaptureHandle` interface the rest of the app
//! already uses.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use tauri::{AppHandle, Emitter, State};

const TARGET_RATE: f64 = 16_000.0;
const CHUNK_SAMPLES: usize = 3_200; // 200 ms @ 16 kHz
const RMS_WINDOW_SAMPLES: u32 = 800; // 50 ms @ 16 kHz

struct CaptureState {
    chunk_buf: Vec<i16>,
    rms_sum: f32,
    rms_count: u32,
}

impl CaptureState {
    fn new() -> Self {
        Self {
            chunk_buf: Vec::with_capacity(CHUNK_SAMPLES),
            rms_sum: 0.0,
            rms_count: 0,
        }
    }
}

pub struct MicState {
    stop_tx: Option<mpsc::Sender<()>>,
}

pub type MicHandle = Arc<Mutex<MicState>>;

pub fn new_mic() -> MicHandle {
    Arc::new(Mutex::new(MicState { stop_tx: None }))
}

#[tauri::command]
pub fn mic_start(app: AppHandle, state: State<'_, MicHandle>) -> Result<(), String> {
    let mut g = state.lock().map_err(|e| format!("lock: {e}"))?;
    if g.stop_tx.is_some() {
        return Err("mic already running".into());
    }
    let (tx, rx) = mpsc::channel::<()>();
    let app_cb = app.clone();
    thread::spawn(move || run_capture(app_cb, rx));
    g.stop_tx = Some(tx);
    Ok(())
}

#[tauri::command]
pub fn mic_stop(state: State<'_, MicHandle>) -> Result<(), String> {
    let mut g = state.lock().map_err(|e| format!("lock: {e}"))?;
    if let Some(tx) = g.stop_tx.take() {
        let _ = tx.send(());
    }
    Ok(())
}

fn run_capture(app: AppHandle, stop_rx: mpsc::Receiver<()>) {
    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            let _ = app.emit("mic://error", "no default input device".to_string());
            return;
        }
    };

    let supported = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            let _ = app.emit("mic://error", format!("default_input_config: {e}"));
            return;
        }
    };

    let sample_rate = supported.sample_rate().0 as f64;
    let channels = supported.channels() as usize;
    let ratio = sample_rate / TARGET_RATE;

    let config: StreamConfig = supported.config();
    let sample_index = Arc::new(AtomicU64::new(0));
    let state = Arc::new(Mutex::new(CaptureState::new()));

    let stream = match supported.sample_format() {
        SampleFormat::F32 => {
            let app_cb = app.clone();
            let state_cb = state.clone();
            let idx_cb = sample_index.clone();
            device.build_input_stream(
                &config,
                move |data: &[f32], _| {
                    process(data, channels, ratio, &idx_cb, &state_cb, &app_cb);
                },
                move |err| eprintln!("cpal err: {err}"),
                None,
            )
        }
        SampleFormat::I16 => {
            let app_cb = app.clone();
            let state_cb = state.clone();
            let idx_cb = sample_index.clone();
            device.build_input_stream(
                &config,
                move |data: &[i16], _| {
                    let f32_data: Vec<f32> = data.iter().map(|&s| s as f32 / 32768.0).collect();
                    process(&f32_data, channels, ratio, &idx_cb, &state_cb, &app_cb);
                },
                move |err| eprintln!("cpal err: {err}"),
                None,
            )
        }
        SampleFormat::U16 => {
            let app_cb = app.clone();
            let state_cb = state.clone();
            let idx_cb = sample_index.clone();
            device.build_input_stream(
                &config,
                move |data: &[u16], _| {
                    let f32_data: Vec<f32> = data
                        .iter()
                        .map(|&s| (s as f32 - 32768.0) / 32768.0)
                        .collect();
                    process(&f32_data, channels, ratio, &idx_cb, &state_cb, &app_cb);
                },
                move |err| eprintln!("cpal err: {err}"),
                None,
            )
        }
        other => {
            let _ = app.emit("mic://error", format!("unsupported fmt: {other:?}"));
            return;
        }
    };

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            let _ = app.emit("mic://error", format!("build_input_stream: {e}"));
            return;
        }
    };

    if let Err(e) = stream.play() {
        let _ = app.emit("mic://error", format!("stream play: {e}"));
        return;
    }

    let _ = app.emit(
        "mic://started",
        format!("{}Hz / {}ch", sample_rate as u32, channels),
    );

    // Block until stop signal, then drop the stream.
    let _ = stop_rx.recv();
    drop(stream);
}

fn process(
    data: &[f32],
    channels: usize,
    ratio: f64,
    sample_index: &Arc<AtomicU64>,
    state: &Arc<Mutex<CaptureState>>,
    app: &AppHandle,
) {
    let mut st = match state.lock() {
        Ok(g) => g,
        Err(_) => return,
    };

    let mut i = 0;
    while i + channels <= data.len() {
        // Downmix to mono.
        let mut sum = 0f32;
        for ch in 0..channels {
            sum += data[i + ch];
        }
        let mono = sum / channels as f32;

        // Decimate by fractional ratio: emit one output sample each time the
        // floor-scaled output index advances.
        let idx = sample_index.fetch_add(1, Ordering::Relaxed);
        let prev_out = (idx as f64 / ratio).floor() as i64;
        let next_out = ((idx + 1) as f64 / ratio).floor() as i64;

        if next_out > prev_out {
            let clamped = mono.clamp(-1.0, 1.0);
            let s16 = (clamped * 32767.0) as i16;
            st.chunk_buf.push(s16);
            st.rms_sum += mono * mono;
            st.rms_count += 1;

            if st.rms_count >= RMS_WINDOW_SAMPLES {
                let rms = (st.rms_sum / st.rms_count as f32).sqrt();
                let _ = app.emit("mic://rms", rms);
                st.rms_sum = 0.0;
                st.rms_count = 0;
            }

            if st.chunk_buf.len() >= CHUNK_SAMPLES {
                let mut bytes = Vec::with_capacity(st.chunk_buf.len() * 2);
                for s in &st.chunk_buf {
                    bytes.extend_from_slice(&s.to_le_bytes());
                }
                let _ = app.emit("mic://chunk", bytes);
                st.chunk_buf.clear();
            }
        }
        i += channels;
    }
}
