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

/// Prefix of `s` no longer than `max_bytes`, cut on a character boundary.
///
/// Log lines used to be built with `&s[..s.len().min(n)]`, which panics the
/// moment the text is not ASCII — a tracker issue in Russian is enough to kill
/// the command mid-flight and leave the UI waiting on a promise that will never
/// settle. Truncation for humans is never worth a panic.
pub fn snippet(s: &str, max_bytes: usize) -> &str {
    if s.len() <= max_bytes {
        return s;
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod tests {
    use super::snippet;

    #[test]
    fn keeps_short_strings_whole() {
        assert_eq!(snippet("abc", 10), "abc");
        assert_eq!(snippet("Привет", 100), "Привет");
    }

    #[test]
    fn cuts_ascii_at_the_limit() {
        assert_eq!(snippet("abcdef", 3), "abc");
    }

    /// The regression: a cut landing inside a multi-byte character.
    #[test]
    fn never_splits_a_utf8_character() {
        let cyrillic = "Задача: заполнить по данным из трекера".repeat(20);
        for limit in 0..300 {
            let cut = snippet(&cyrillic, limit);
            assert!(cut.len() <= limit);
            assert!(cyrillic.starts_with(cut));
        }
        // 'П' occupies bytes 0..2, so a 1-byte budget must yield nothing.
        assert_eq!(snippet("Привет", 1), "");
    }
}
