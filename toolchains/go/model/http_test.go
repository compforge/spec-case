package model

import (
	"encoding/json"
	"os"
	"testing"
)

func TestHTTPConformance(t *testing.T) {
	data, err := os.ReadFile("../../../conformance/case/http.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct {
		Valid   []Case `json:"valid"`
		Invalid []Case `json:"invalid"`
	}
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatal(err)
	}
	for _, item := range fixture.Valid {
		if err := ValidateHTTPCase(item); err != nil {
			t.Fatal(err)
		}
	}
	for _, item := range fixture.Invalid {
		if err := ValidateHTTPCase(item); err == nil {
			t.Fatalf("accepted invalid input: %v", item.Input)
		}
	}
}
