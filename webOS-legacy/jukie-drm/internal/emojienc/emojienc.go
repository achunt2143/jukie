// Package emojienc turns characters outside the Basic Multilingual Plane (emoji and
// friends) into a reversible ASCII marker, "{{e:1F970}}" (the code point in hex).
//
// Why: webOS's JS services (Node 0.4 + the palmbus binding) cannot carry a UTF-16
// surrogate pair across the Luna bus. On a Pre2 the reply is swallowed outright; on a
// TouchPad it arrives with each half turned into a literal "?". Stripping the characters
// (see apple.stripAstral) is safe but lossy. This keeps them: the marker is plain ASCII,
// so it crosses any bus, db8 and JSON string untouched, and the page turns it back into
// the real character (JukieEmoji.decode in the Enyo/Mojo apps) only if that device can
// actually draw it - otherwise it removes the marker, which is what stripping did.
//
// The marker text contains no quotes, backslashes or angle brackets, so it is also
// valid inside a JSON string and inert in HTML.
package emojienc

import (
	"strconv"
	"strings"
)

const (
	prefix = "{{e:"
	suffix = "}}"
)

func marker(r rune) string {
	return prefix + strings.ToUpper(strconv.FormatInt(int64(r), 16)) + suffix
}

func hasAstral(s string) bool {
	for _, r := range s {
		if r > 0xFFFF {
			return true
		}
	}
	return false
}

// Encode replaces every code point above U+FFFF in the plain text s with its marker.
// Text without any is returned unchanged (same string, no copy).
func Encode(s string) string {
	if !hasAstral(s) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s) + 16)
	for _, r := range s {
		if r > 0xFFFF {
			b.WriteString(marker(r))
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// EncodeJSON does the same for a whole JSON document body. Apple spells an emoji two
// ways and both are handled:
//
//  1. JSON-escaped - a surrogate pair spelled out as ASCII, e.g. 🥰. The pair
//     is combined into its code point and replaced by the marker. A lone surrogate
//     escape has no valid code point and is dropped.
//  2. Raw UTF-8 - the 4-byte encoding of a code point above U+FFFF.
//
// Only string content can ever be affected: JSON syntax is pure ASCII and whole escape
// units are replaced, so the document structure cannot be corrupted. A literal `\\` is
// copied through as a unit so an escaped backslash followed by "u" is not mistaken for
// the start of an escape.
func EncodeJSON(b []byte) []byte {
	b = encodeEscapedPairs(b)
	if !hasAstral(string(b)) {
		return b
	}
	return []byte(Encode(string(b)))
}

// hex4 parses the four hex digits at b[i:i+4]; ok is false if they are not all hex.
func hex4(b []byte, i int) (v uint32, ok bool) {
	if i+4 > len(b) {
		return 0, false
	}
	n, err := strconv.ParseUint(string(b[i:i+4]), 16, 32)
	if err != nil {
		return 0, false
	}
	return uint32(n), true
}

func encodeEscapedPairs(b []byte) []byte {
	out := make([]byte, 0, len(b))
	for i := 0; i < len(b); {
		if b[i] != '\\' {
			out = append(out, b[i])
			i++
			continue
		}
		if i+1 < len(b) && b[i+1] == '\\' {
			out = append(out, '\\', '\\')
			i += 2
			continue
		}
		if i+1 < len(b) && b[i+1] == 'u' {
			if v, ok := hex4(b, i+2); ok && v >= 0xD800 && v <= 0xDFFF {
				// A high surrogate directly followed by a low one is one astral code point.
				if v <= 0xDBFF && i+11 < len(b) && b[i+6] == '\\' && b[i+7] == 'u' {
					if lo, ok2 := hex4(b, i+8); ok2 && lo >= 0xDC00 && lo <= 0xDFFF {
						cp := rune(0x10000 + ((v - 0xD800) << 10) + (lo - 0xDC00))
						out = append(out, marker(cp)...)
						i += 12
						continue
					}
				}
				i += 6 // lone surrogate: nothing valid to keep
				continue
			}
		}
		out = append(out, b[i])
		i++
	}
	return out
}
