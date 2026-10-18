package emojienc

import (
	"encoding/json"
	"testing"
)

func TestEncode(t *testing.T) {
	cases := []struct{ in, want string }{
		{"plain text", "plain text"},
		{"Tiësto & Tate McRae – 360", "Tiësto & Tate McRae – 360"}, // BMP non-ASCII is untouched
		{"90s \U0001F970", "90s {{e:1F970}}"},
		{"\U0001F600\U0001F389", "{{e:1F600}}{{e:1F389}}"},
		{"a\U0001D400b", "a{{e:1D400}}b"}, // mathematical bold A: astral but not an emoji
		{"❤️ stays", "❤️ stays"},          // U+2764 U+FE0F are BMP
		{"", ""},
	}
	for _, c := range cases {
		if got := Encode(c.in); got != c.want {
			t.Errorf("Encode(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestEncodeJSON(t *testing.T) {
	cases := []struct{ name, in, want string }{
		{"escaped pair", `{"name":"90s 🥰"}`, `{"name":"90s {{e:1F970}}"}`},
		{"escaped pair, upper-case hex", `{"n":"😀"}`, `{"n":"{{e:1F600}}"}`},
		{"raw utf-8", "{\"n\":\"a \U0001F970 b\"}", `{"n":"a {{e:1F970}} b"}`},
		{"both forms", "{\"a\":\"\\ud83e\\udd70\",\"b\":\"\U0001F600\"}", `{"a":"{{e:1F970}}","b":"{{e:1F600}}"}`},
		{"two pairs in a row", `{"n":"😀😁"}`, `{"n":"{{e:1F600}}{{e:1F601}}"}`},
		{"lone high surrogate dropped", `{"n":"a\ud83eb"}`, `{"n":"ab"}`},
		{"lone low surrogate dropped", `{"n":"a\udd70b"}`, `{"n":"ab"}`},
		{"escaped backslash then text is not an escape", `{"n":"\\ud83e\\udd70"}`, `{"n":"\\ud83e\\udd70"}`},
		{"other escapes untouched", `{"n":"line\nbreak é \"q\""}`, `{"n":"line\nbreak é \"q\""}`},
		{"no emoji", `{"n":"hello"}`, `{"n":"hello"}`},
		{"truncated escape", `{"n":"\ud83e\ud`, `{"n":"` + `\ud`},
	}
	for _, c := range cases {
		got := string(EncodeJSON([]byte(c.in)))
		if c.name == "truncated escape" {
			// A cut-off body is not valid JSON anyway; it just must not panic or loop.
			continue
		}
		if got != c.want {
			t.Errorf("%s: EncodeJSON(%q) = %q, want %q", c.name, c.in, got, c.want)
		}
	}
}

// Whatever goes in, valid JSON must come out valid, and must hold only BMP text.
func TestEncodeJSONKeepsDocumentValid(t *testing.T) {
	in := "{\"data\":[{\"attributes\":{\"name\":\"90s \\ud83e\\udd70\",\"artistName\":\"\U0001F600 Band\",\"x\":\"\\\\u1234\"}}]}"
	out := EncodeJSON([]byte(in))
	var v map[string]any
	if err := json.Unmarshal(out, &v); err != nil {
		t.Fatalf("output is not valid JSON: %v\n%s", err, out)
	}
	for _, r := range string(out) {
		if r > 0xFFFF {
			t.Fatalf("output still contains an astral rune: %q", out)
		}
	}
	attrs := v["data"].([]any)[0].(map[string]any)["attributes"].(map[string]any)
	if attrs["name"] != "90s {{e:1F970}}" || attrs["artistName"] != "{{e:1F600}} Band" || attrs["x"] != "\\"+"u1234" {
		t.Fatalf("unexpected decoded attributes: name=%q artist=%q x=%q", attrs["name"], attrs["artistName"], attrs["x"])
	}
}
