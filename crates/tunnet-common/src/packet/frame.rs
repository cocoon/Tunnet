//! Datagram Framing v2: the only tunnel wire format.
//!
//! A logical (inner IP) packet that fits the current QUIC DATAGRAM payload
//! limit travels as one `Single` frame. Larger logical packets are split into
//! `Segment` frames and reassembled by the peer. There is no v1 compatibility
//! decoder: v2 endpoints negotiate `tunnet/tunnel/2` and reject anything else.
//!
//! Layout (all integers little-endian, minimal overhead):
//!
//! ```text
//! Single:  [0x20][logical packet bytes...]                    (1 byte overhead)
//! Segment: [0x21][id u32][index u16][count u16][total u16][payload]
//!                                                         (11 bytes overhead)
//! ```
//!
//! Kinds `0x22..=0x2F` are reserved for future extensions (e.g. GSO-aware
//! frames); the version nibble `0x2_` leaves `0x3_`.. for future wire versions.
//! Decoder properties: fixed/cheap header parse, no allocation to decode a
//! header, malformed frames rejected before allocation, no integer overflow
//! (checked arithmetic throughout), no ambiguous encodings, deterministic
//! encoding, fuzzable decoder.

use super::owned::MAX_LOGICAL_LEN;

/// Maximum segments per logical packet (9000 B / ~1200 B MPS ≈ 8; headroom 2×).
pub const MAX_SEGMENTS: usize = 16;
/// Minimum useful segment payload (pathological tiny segments rejected).
pub const MIN_SEGMENT_PAYLOAD: usize = 64;

pub const KIND_SINGLE: u8 = 0x20;
pub const KIND_SEGMENT: u8 = 0x21;
const KIND_RESERVED_MAX: u8 = 0x2F;
const SEG_HEADER_LEN: usize = 11;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SegmentHeader {
    pub id: u32,
    pub index: u16,
    pub count: u16,
    pub total: u16,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frame<'a> {
    Single(&'a [u8]),
    Segment(SegmentHeader, &'a [u8]),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeError {
    Empty,
    UnknownKind(u8),
    ReservedKind(u8),
    TruncatedHeader,
    TruncatedPayload,
    EmptyPayload,
    BadCount,
    BadIndex,
    BadTotal,
    SingleSegment,
    OversizeSegment,
}

impl std::fmt::Display for DecodeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}

impl std::error::Error for DecodeError {}

/// Decode a frame header + payload borrows. No allocation.
pub fn decode(data: &[u8]) -> Result<Frame<'_>, DecodeError> {
    let Some((&kind, rest)) = data.split_first() else {
        return Err(DecodeError::Empty);
    };
    match kind {
        KIND_SINGLE => {
            if rest.is_empty() {
                return Err(DecodeError::EmptyPayload);
            }
            if rest.len() > MAX_LOGICAL_LEN {
                return Err(DecodeError::BadTotal);
            }
            Ok(Frame::Single(rest))
        }
        KIND_SEGMENT => {
            if rest.len() < SEG_HEADER_LEN - 1 {
                return Err(DecodeError::TruncatedHeader);
            }
            let id = u32::from_le_bytes(rest[0..4].try_into().expect("len"));
            let index = u16::from_le_bytes(rest[4..6].try_into().expect("len"));
            let count = u16::from_le_bytes(rest[6..8].try_into().expect("len"));
            let total = u16::from_le_bytes(rest[8..10].try_into().expect("len"));
            let payload = &rest[10..];
            if count < 2 || (count as usize) > MAX_SEGMENTS {
                return Err(DecodeError::BadCount);
            }
            if index >= count {
                return Err(DecodeError::BadIndex);
            }
            if total == 0 || (total as usize) > MAX_LOGICAL_LEN {
                return Err(DecodeError::BadTotal);
            }
            if payload.is_empty() {
                return Err(DecodeError::EmptyPayload);
            }
            // Last segment may be short; non-last segments must carry a
            // meaningful payload (prevents index/count smuggling games).
            if index + 1 < count && payload.len() < MIN_SEGMENT_PAYLOAD {
                return Err(DecodeError::TruncatedPayload);
            }
            // A segment can never carry more than the whole logical packet.
            // (Non-last segments are sized by the sender's path MPS, which
            // the decoder cannot know; the reassembly layer additionally
            // caps count × total per peer, so no allocation amplification.)
            if payload.len() > total as usize {
                return Err(DecodeError::OversizeSegment);
            }
            if payload.len() > MAX_LOGICAL_LEN {
                return Err(DecodeError::OversizeSegment);
            }
            Ok(Frame::Segment(
                SegmentHeader {
                    id,
                    index,
                    count,
                    total,
                },
                payload,
            ))
        }
        k if (k & 0xF0) == 0x20 && k <= KIND_RESERVED_MAX => Err(DecodeError::ReservedKind(k)),
        k => Err(DecodeError::UnknownKind(k)),
    }
}

/// Encode a single frame header byte into `out[..1]`. Returns 1.
pub fn encode_single_prefix(out: &mut [u8]) -> usize {
    out[0] = KIND_SINGLE;
    1
}

/// Encode an 11-byte segment header into `out[..11]`. Returns 11.
pub fn encode_segment_prefix(out: &mut [u8], h: SegmentHeader) -> usize {
    out[0] = KIND_SEGMENT;
    out[1..5].copy_from_slice(&h.id.to_le_bytes());
    out[5..7].copy_from_slice(&h.index.to_le_bytes());
    out[7..9].copy_from_slice(&h.count.to_le_bytes());
    out[9..11].copy_from_slice(&h.total.to_le_bytes());
    SEG_HEADER_LEN
}

pub const SINGLE_OVERHEAD: usize = 1;
pub const SEGMENT_OVERHEAD: usize = SEG_HEADER_LEN;

/// Number of segments needed for `logical_len` bytes at `mps` payload bytes
/// per DATAGRAM (accounting framing overhead). None when impossible.
pub fn segment_count(logical_len: usize, mps: usize) -> Option<usize> {
    if logical_len == 0 || logical_len > MAX_LOGICAL_LEN {
        return None;
    }
    let single_cap = mps.checked_sub(SINGLE_OVERHEAD)?;
    if logical_len <= single_cap {
        return Some(1);
    }
    let seg_cap = mps.checked_sub(SEGMENT_OVERHEAD)?;
    if seg_cap < MIN_SEGMENT_PAYLOAD {
        return None;
    }
    Some(logical_len.div_ceil(seg_cap))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_round_trip() {
        let mut buf = [0u8; 64];
        assert_eq!(encode_single_prefix(&mut buf), 1);
        buf[1..6].copy_from_slice(b"hello");
        match decode(&buf[..6]).unwrap() {
            Frame::Single(p) => assert_eq!(p, b"hello"),
            _ => panic!("expected single"),
        }
    }

    #[test]
    fn segment_round_trip() {
        let mut buf = [0u8; 1024];
        let h = SegmentHeader {
            id: 0xdead_beef,
            index: 2,
            count: 5,
            total: 4000,
        };
        assert_eq!(encode_segment_prefix(&mut buf, h), 11);
        // Non-last segments carry full payloads.
        buf[11..11 + 800].fill(0xAB);
        match decode(&buf[..11 + 800]).unwrap() {
            Frame::Segment(got, p) => {
                assert_eq!(got, h);
                assert_eq!(p.len(), 800);
            }
            _ => panic!("expected segment"),
        }
        // Last segment may be short.
        let last = SegmentHeader { index: 4, ..h };
        assert_eq!(encode_segment_prefix(&mut buf, last), 11);
        buf[11..16].copy_from_slice(b"world");
        match decode(&buf[..16]).unwrap() {
            Frame::Segment(got, p) => {
                assert_eq!(got, last);
                assert_eq!(p, b"world");
            }
            _ => panic!("expected segment"),
        }
    }

    #[test]
    fn rejects_garbage_before_allocation() {
        assert_eq!(decode(&[]), Err(DecodeError::Empty));
        assert_eq!(decode(&[0x99]), Err(DecodeError::UnknownKind(0x99)));
        assert_eq!(decode(&[0x22]), Err(DecodeError::ReservedKind(0x22)));
        assert_eq!(decode(&[KIND_SINGLE]), Err(DecodeError::EmptyPayload));
        assert_eq!(decode(&[KIND_SEGMENT]), Err(DecodeError::TruncatedHeader));
        assert_eq!(
            decode(&[KIND_SEGMENT, 1, 2, 3]),
            Err(DecodeError::TruncatedHeader)
        );
        // count < 2
        let mut bad = [0u8; 16];
        encode_segment_prefix(
            &mut bad,
            SegmentHeader {
                id: 1,
                index: 0,
                count: 1,
                total: 100,
            },
        );
        assert_eq!(decode(&bad[..16]), Err(DecodeError::BadCount));
        // count > MAX
        encode_segment_prefix(
            &mut bad,
            SegmentHeader {
                id: 1,
                index: 0,
                count: 99,
                total: 100,
            },
        );
        assert_eq!(decode(&bad[..16]), Err(DecodeError::BadCount));
        // index >= count
        encode_segment_prefix(
            &mut bad,
            SegmentHeader {
                id: 1,
                index: 3,
                count: 3,
                total: 300,
            },
        );
        bad[11] = 7;
        assert_eq!(decode(&bad[..12]), Err(DecodeError::BadIndex));
    }

    #[test]
    fn rejects_bad_totals_and_tiny_segments() {
        let mut buf = [0u8; 80];
        // total 0
        encode_segment_prefix(
            &mut buf,
            SegmentHeader {
                id: 1,
                index: 0,
                count: 2,
                total: 0,
            },
        );
        buf[11] = 1;
        assert_eq!(decode(&buf[..12]), Err(DecodeError::BadTotal));
        // total > max
        encode_segment_prefix(
            &mut buf,
            SegmentHeader {
                id: 1,
                index: 0,
                count: 2,
                total: 9001,
            },
        );
        assert_eq!(decode(&buf[..12]), Err(DecodeError::BadTotal));
        // non-last tiny payload
        encode_segment_prefix(
            &mut buf,
            SegmentHeader {
                id: 1,
                index: 0,
                count: 3,
                total: 3000,
            },
        );
        buf[11] = 1;
        assert_eq!(decode(&buf[..12]), Err(DecodeError::TruncatedPayload));
        // empty payload
        encode_segment_prefix(
            &mut buf,
            SegmentHeader {
                id: 1,
                index: 2,
                count: 3,
                total: 3000,
            },
        );
        assert_eq!(decode(&buf[..11]), Err(DecodeError::EmptyPayload));
    }

    #[test]
    fn segment_count_boundaries() {
        // exact fit → single
        assert_eq!(segment_count(1200, 1201), Some(1));
        // one byte over → segmented
        assert_eq!(segment_count(1201, 1201), Some(2));
        assert_eq!(segment_count(0, 1200), None);
        assert_eq!(segment_count(9001, 1500), None);
        // 2800 logical at 1350 MPS: seg cap 1339 → 3 segments
        assert_eq!(segment_count(2800, 1350), Some(3));
        // degenerate MPS
        assert_eq!(segment_count(100, 10), None);
    }

    #[test]
    fn deterministic_encoding() {
        let h = SegmentHeader {
            id: 7,
            index: 1,
            count: 4,
            total: 5000,
        };
        let mut a = [0u8; 11];
        let mut b = [0u8; 11];
        encode_segment_prefix(&mut a, h);
        encode_segment_prefix(&mut b, h);
        assert_eq!(a, b);
        assert_eq!(a[0], KIND_SEGMENT);
    }
}

#[cfg(test)]
mod proptests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// Any byte string either decodes deterministically or fails with a
        /// stable error; decoding never panics and never allocates.
        #[test]
        fn decode_never_panics(data in prop::collection::vec(any::<u8>(), 0..64)) {
            let a = decode(&data).map_err(|e| format!("{e:?}"));
            let b = decode(&data).map_err(|e| format!("{e:?}"));
            prop_assert_eq!(a.as_ref().map(|_| ()), b.as_ref().map(|_| ()));
            prop_assert_eq!(a.is_ok(), b.is_ok());
            if let Ok(frame) = a {
                match frame {
                    Frame::Single(p) => {
                        prop_assert!(!p.is_empty() && p.len() <= MAX_LOGICAL_LEN);
                    }
                    Frame::Segment(h, p) => {
                        prop_assert!((h.count as usize) >= 2 && (h.count as usize) <= MAX_SEGMENTS);
                        prop_assert!(h.index < h.count);
                        prop_assert!(!p.is_empty() && p.len() <= h.total as usize);
                    }
                }
            }
        }

        /// Encoded segment headers always decode to themselves.
        #[test]
        fn segment_header_round_trip(
            id in any::<u32>(),
            index in 0..16u16,
            count in 2..16u16,
            total in 1..9000u16,
        ) {
            // Non-last segments must carry full payloads, so only test
            // totals that admit them (small totals are covered by unit tests).
            prop_assume!((total as usize) >= (count as usize) * MIN_SEGMENT_PAYLOAD);
            let index = index % count;
            let h = SegmentHeader { id, index, count, total };
            let mut buf = [0u8; 11];
            prop_assert_eq!(encode_segment_prefix(&mut buf, h), 11);
            let payload_len = if index + 1 < count {
                MIN_SEGMENT_PAYLOAD
            } else {
                1usize
            };
            let mut full = vec![0u8; 11 + payload_len];
            full[..11].copy_from_slice(&buf);
            for (i, b) in full[11..].iter_mut().enumerate() {
                *b = (i & 0xff) as u8;
            }
            match decode(&full) {
                Ok(Frame::Segment(got, p)) => {
                    prop_assert_eq!(got, h);
                    prop_assert_eq!(p.len(), payload_len);
                }
                Ok(Frame::Single(_)) => prop_assert!(false, "segment must not decode as single"),
                Err(e) => prop_assert!(false, "unexpected decode error: {e:?}"),
            }
        }
    }
}
