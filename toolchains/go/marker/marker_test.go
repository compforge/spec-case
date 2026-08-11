package marker

import "testing"

func TestParseAndIntentHash(t *testing.T) {
	doc := "// +spec=`tenant required`\n" +
		"// +case:id=happy,desc=`a, b`,input=plain,expect=`200; ok`,group=sandbox\n" +
		"// +case:id=Bad-ID,desc=skip\n" +
		"// +link=docs/api.md\n" +
		"// +rule=`watch sync I/O`\n"

	parsed := Parse(doc)
	if parsed.Spec != "tenant required" || len(parsed.Cases) != 1 {
		t.Fatalf("Parse() = %+v", parsed)
	}
	c := parsed.Cases[0]
	if c.ID != "happy" || c.Desc != "a, b" || c.Input != "plain" || c.Group != "sandbox" {
		t.Fatalf("case = %+v", c)
	}
	if len(parsed.Links) != 1 || len(parsed.Rules) != 1 {
		t.Fatalf("links/rules = %+v/%+v", parsed.Links, parsed.Rules)
	}

	hash := IntentHash(c, parsed.Spec)
	c.Group = "other"
	if IntentHash(c, parsed.Spec) != hash {
		t.Fatal("group-only change must not alter executable intent hash")
	}
	c.Expect = "201"
	if IntentHash(c, parsed.Spec) == hash {
		t.Fatal("expectation change must alter executable intent hash")
	}
}

func TestParseNamedSpec(t *testing.T) {
	parsed := Parse("// +spec:id=string_input,text=`accepts strings`")
	if parsed.SpecID != "string_input" || parsed.Spec != "accepts strings" {
		t.Fatalf("Parse() = %+v", parsed)
	}
}
