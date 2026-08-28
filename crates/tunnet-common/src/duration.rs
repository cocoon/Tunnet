//! Compact human duration parsing (e.g. `3d`, `12h`, `30m`).

/// Parse a duration string to whole seconds. Returns `None` for invalid input.
pub fn parse_human_duration_secs(s: &str) -> Option<i64> {
    let s = s.trim();
    if s.is_empty() || s.len() > 100 {
        return None;
    }

    let (digits, unit): (&str, &str) = s
        .char_indices()
        .find(|(_, c)| !c.is_ascii_digit())
        .map(|(idx, _)| s.split_at(idx))
        .unwrap_or((s, ""));

    if digits.is_empty() {
        return None;
    }
    let amount: i64 = digits.parse().ok()?;
    if amount <= 0 {
        return None;
    }

    let multiplier = match unit.trim().to_ascii_lowercase().as_str() {
        "s" | "sec" | "secs" | "second" | "seconds" => 1,
        "m" | "min" | "mins" | "minute" | "minutes" => 60,
        "h" | "hr" | "hrs" | "hour" | "hours" => 3_600,
        "d" | "day" | "days" => 86_400,
        "w" | "week" | "weeks" => 604_800,
        "" => return None,
        _ => return None,
    };

    amount.checked_mul(multiplier)
}

/// Convert seconds to a PostgreSQL interval literal (`N seconds`).
pub fn seconds_to_pg_interval(seconds: i64) -> String {
    format!("{seconds} seconds")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rstest::rstest;

    #[rstest]
    #[case::seconds("15 seconds", Some(15))]
    #[case::minutes("30m", Some(1_800))]
    #[case::hours_case_insensitive("2 HRS", Some(7_200))]
    #[case::days("3d", Some(259_200))]
    #[case::weeks("1w", Some(604_800))]
    #[case::surrounding_whitespace(" 5 min ", Some(300))]
    #[case::missing_unit("30", None)]
    #[case::zero("0s", None)]
    #[case::negative("-1h", None)]
    #[case::unknown_unit("1month", None)]
    #[case::overflow("9223372036854775807w", None)]
    fn parses_human_duration(#[case] input: &str, #[case] expected: Option<i64>) {
        assert_eq!(parse_human_duration_secs(input), expected);
    }
}
