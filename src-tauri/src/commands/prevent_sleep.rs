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
    #[cfg(not(target_os = "macos"))]
    {
        // Windows: TODO — SetThreadExecutionState. Linux: TODO — systemd-inhibit.
        // For M1, Windows/Linux are a no-op; meeting proceeds without sleep prevention.
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
    Ok(())
}
