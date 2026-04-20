#![cfg(feature = "ws-integration")]

use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use tokio::net::TcpListener;
use tokio_tungstenite::{accept_async, tungstenite::protocol::Message};

// Spins up a mock WS server on an ephemeral port, returns its addr.
async fn mock_server_echo_partial() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        if let Ok((stream, _)) = listener.accept().await {
            let ws = accept_async(stream).await.unwrap();
            let (mut sink, mut rx) = ws.split();
            // On first binary frame from client, reply with a stubbed server response frame
            if let Some(Ok(Message::Binary(_))) = rx.next().await {
                let json = br#"{"result":{"text":"hi","utterances":[{"text":"hi","start_time":0,"end_time":100,"definite":true}]}}"#;
                let mut frame: Vec<u8> = vec![0x11, 0x91, 0x10, 0x00];
                frame.extend_from_slice(&1u32.to_be_bytes());
                frame.extend_from_slice(&(json.len() as u32).to_be_bytes());
                frame.extend_from_slice(json);
                let _ = sink.send(Message::Binary(frame.into())).await;
            }
        }
    });
    addr
}

#[tokio::test]
async fn mock_server_round_trip() {
    let addr = mock_server_echo_partial().await;
    // Direct WS round-trip: open, send dummy first frame, expect server response frame
    use tokio_tungstenite::connect_async;
    let url = format!("ws://{}/", addr);
    let (ws, _) = connect_async(url).await.expect("connect");
    let (mut sink, mut stream) = ws.split();
    sink.send(Message::Binary(vec![0u8; 8].into()))
        .await
        .unwrap();
    let msg = stream.next().await.unwrap().unwrap();
    assert!(matches!(msg, Message::Binary(_)));
}
