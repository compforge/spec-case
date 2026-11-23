package model

import (
	"encoding/json"
	"os"
	"reflect"
	"testing"
)

func TestLoadAndValidateCanonicalConformanceCaseSet(t *testing.T) {
	cases, err := Load("../../../conformance/case/cases.yaml")
	if err != nil {
		t.Fatal(err)
	}
	if err := Validate(cases); err != nil {
		t.Fatal(err)
	}
	if cases.CaseSet != "canonical-model" || cases.SchemaVersion != 1 || len(cases.Cases) != 1 {
		t.Fatalf("CaseSet = %+v", cases)
	}
	item := cases.Cases[0]
	if item.ID != "answer_document" || item.Facets["topic"] != "retrieval" ||
		item.Binding == nil || item.Binding.SymbolID != "internal/api/answer.go::Handler.Answer" ||
		item.Binding.SpecID == nil || *item.Binding.SpecID != "grounded_answer" {
		t.Fatalf("Case = %+v", item)
	}
	if len(item.Judge["e2e"]) == 0 || len(item.Judge["eval"]) == 0 {
		t.Fatalf("judge faces = %+v", item.Judge)
	}
}

func TestValidateRejectsBrokenReferencesAndVocabulary(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*CaseSet)
	}{
		{"duplicate case", func(cases *CaseSet) { cases.Cases = append(cases.Cases, cases.Cases[0]) }},
		{"unknown source", func(cases *CaseSet) { cases.Cases[0].Requires = []string{"missing"} }},
		{"unknown facet", func(cases *CaseSet) { cases.Cases[0].Facets["lang"] = "go" }},
		{"facet value", func(cases *CaseSet) { cases.Cases[0].Facets["difficulty"] = "medium" }},
		{"judge face", func(cases *CaseSet) { cases.Cases[0].Judge["taste"] = map[string]any{} }},
		{"binding", func(cases *CaseSet) { cases.Cases[0].Binding.SymbolID = "missing-delimiter" }},
		{"binding spec id", func(cases *CaseSet) { cases.Cases[0].Binding.SpecID = stringPointer("Bad-ID") }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cases, err := Load("../../../conformance/case/cases.yaml")
			if err != nil {
				t.Fatal(err)
			}
			test.mutate(&cases)
			if err := Validate(cases); err == nil {
				t.Fatal("Validate accepted an invalid CaseSet")
			}
		})
	}
}

func TestBindingSpecIDJSONRoundTrip(t *testing.T) {
	original := Binding{
		SymbolID: "internal/api/answer.go::Handler.Answer",
		SpecID:   stringPointer("grounded_answer"),
		Spec:     "Answers use the selected document.",
	}
	data, err := json.Marshal(original)
	if err != nil {
		t.Fatal(err)
	}
	var decoded Binding
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.SpecID == nil || *decoded.SpecID != "grounded_answer" {
		t.Fatalf("Binding after JSON round-trip = %+v", decoded)
	}
}

func TestCaseHashAndSourceKeyAreContentAddressed(t *testing.T) {
	cases, err := Load("../../../conformance/case/cases.yaml")
	if err != nil {
		t.Fatal(err)
	}
	first, err := CaseHash(cases.Cases[0])
	if err != nil {
		t.Fatal(err)
	}
	if first != "5eac99dc" {
		t.Fatalf("cross-language Case hash = %q, want Python hash 5eac99dc", first)
	}
	cases.Cases[0].Desc = "cosmetic change"
	second, err := CaseHash(cases.Cases[0])
	if err != nil {
		t.Fatal(err)
	}
	if first != second || len(first) != 8 {
		t.Fatalf("cosmetic Case hash drifted: %q != %q", first, second)
	}
	cases.Cases[0].Input["query"] = "different"
	third, err := CaseHash(cases.Cases[0])
	if err != nil {
		t.Fatal(err)
	}
	if third == first {
		t.Fatal("semantic Case change did not change its hash")
	}
	if cases.Sources[0].Key() == (Source{Name: "other", Content: stringPointer("different")}).Key() {
		t.Fatal("different Source content produced the same key")
	}
	empty, err := CaseHash(Case{ID: "empty", Input: map[string]any{}, Facets: map[string]string{}, Judge: map[string]map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if empty != "1fd92585" {
		t.Fatalf("empty-field Case hash = %q, want Python hash 1fd92585", empty)
	}
}

func TestLoadDistinguishesMissingAndExplicitSchemaVersion(t *testing.T) {
	path := t.TempDir() + "/cases.yaml"
	if err := os.WriteFile(path, []byte("caseset: demo\nschema_version: 0\ncases: []\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	cases, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cases.SchemaVersion != 0 {
		t.Fatalf("explicit schema version = %d, want 0", cases.SchemaVersion)
	}
}

func stringPointer(value string) *string { return &value }

func TestParamConformance(t *testing.T) {
	data, err := os.ReadFile("../../../conformance/case/params.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Case    json.RawMessage
		Hash    string
		Invalid []map[string]Param `json:"invalid_params"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}

	// Load through the normal YAML reader, including its defaults for omitted case fields.
	path := t.TempDir() + "/cases.yaml"
	content := "caseset: params\ncases: [" + string(fixture.Case) + "]\n"
	if err := os.WriteFile(path, []byte(content), 0600); err != nil {
		t.Fatal(err)
	}
	cs, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := Validate(cs); err != nil {
		t.Fatal(err)
	}
	item := cs.Cases[0]
	got, err := CaseHash(item)
	if err != nil || got != fixture.Hash {
		t.Fatalf("hash = %s, error = %v; want %s", got, err, fixture.Hash)
	}
	encoded, err := json.Marshal(item)
	if err != nil {
		t.Fatal(err)
	}
	var want, actual map[string]any
	if err := json.Unmarshal(fixture.Case, &want); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(encoded, &actual); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, want) {
		t.Fatalf("round trip = %v, want %v", actual, want)
	}

	for _, params := range fixture.Invalid {
		cs.Cases[0].Params = params
		if err := Validate(cs); err == nil {
			t.Errorf("accepted invalid params %v", params)
		}
	}
}
