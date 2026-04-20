use once_cell::sync::Lazy;
use std::sync::Mutex;

#[cfg(target_os = "macos")]
mod mac {
    use core_foundation::base::TCFType;
    use core_foundation::string::{CFString, CFStringRef};

    pub type IoPmAssertionId = u32;

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        pub fn IOPMAssertionCreateWithName(
            assertion_type: CFStringRef,
            assertion_level: u32,
            assertion_name: CFStringRef,
            assertion_id: *mut IoPmAssertionId,
        ) -> i32;
        pub fn IOPMAssertionRelease(assertion_id: IoPmAssertionId) -> i32;
    }

    pub fn enable(reason: &str) -> Option<IoPmAssertionId> {
        let ty = CFString::new("NoDisplaySleepAssertion");
        let name = CFString::new(reason);
        let mut id: IoPmAssertionId = 0;
        unsafe {
            if IOPMAssertionCreateWithName(
                ty.as_concrete_TypeRef(),
                255,
                name.as_concrete_TypeRef(),
                &mut id,
            ) == 0
            {
                Some(id)
            } else {
                None
            }
        }
    }

    pub fn disable(id: IoPmAssertionId) {
        unsafe {
            IOPMAssertionRelease(id);
        }
    }
}

#[cfg(target_os = "windows")]
mod win {
    use windows::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
        EXECUTION_STATE,
    };

    pub fn start() -> Result<(), String> {
        // SAFETY: Win32 API, no pointers; EXECUTION_STATE is a u32 bitfield.
        let prev = unsafe {
            SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
        };
        if prev == EXECUTION_STATE(0) {
            Err("SetThreadExecutionState failed".into())
        } else {
            Ok(())
        }
    }

    pub fn stop() -> Result<(), String> {
        let prev = unsafe { SetThreadExecutionState(ES_CONTINUOUS) };
        if prev == EXECUTION_STATE(0) {
            Err("SetThreadExecutionState clear failed".into())
        } else {
            Ok(())
        }
    }
}

static ACTIVE: Lazy<Mutex<Option<u32>>> = Lazy::new(|| Mutex::new(None));

#[tauri::command]
pub async fn prevent_sleep_enable(_reason: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut guard = ACTIVE.lock().unwrap();
        if guard.is_some() {
            return Ok(());
        }
        if let Some(id) = mac::enable(&_reason) {
            *guard = Some(id);
        } else {
            return Err("IOPMAssertionCreateWithName failed".into());
        }
    }
    #[cfg(target_os = "windows")]
    {
        win::start()?;
        let _ = _reason;
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        // Linux: TODO — systemd-inhibit. No-op for now; meeting proceeds without sleep prevention.
        let _ = _reason;
    }
    Ok(())
}

#[tauri::command]
pub async fn prevent_sleep_disable() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let mut guard = ACTIVE.lock().unwrap();
        if let Some(id) = guard.take() {
            mac::disable(id);
        }
    }
    #[cfg(target_os = "windows")]
    {
        win::stop()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[cfg(target_os = "windows")]
    #[test]
    fn windows_start_stop_round_trip() {
        super::win::start().unwrap();
        super::win::stop().unwrap();
    }
}
