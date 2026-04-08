use std::sync::Mutex;

static LOG_BUFFER: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn log(level: &str, msg: &str) {
    let entry = format!("[{}] {}", level, msg);
    eprintln!("{}", entry);
    if let Ok(mut buf) = LOG_BUFFER.lock() {
        buf.push(entry);
        // Keep last 200
        if buf.len() > 200 {
            let drain = buf.len() - 200;
            buf.drain(..drain);
        }
    }
}

pub fn drain() -> Vec<String> {
    if let Ok(mut buf) = LOG_BUFFER.lock() {
        buf.drain(..).collect()
    } else {
        Vec::new()
    }
}
