// Package model owns the Go projection of the canonical CaseSet asset.
package model

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"slices"

	"gopkg.in/yaml.v3"
)

const SchemaVersion = 1

var (
	caseIDPattern   = regexp.MustCompile(`^[a-z][a-z0-9_]*$`)
	symbolIDPattern = regexp.MustCompile(`^[^:]+::[^:]+$`)
)

type Source struct {
	Name    string         `yaml:"name" json:"name"`
	URI     *string        `yaml:"uri,omitempty" json:"uri,omitempty"`
	Content *string        `yaml:"content,omitempty" json:"content,omitempty"`
	Meta    map[string]any `yaml:"meta,omitempty" json:"meta,omitempty"`
}

func (s Source) Key() string {
	seed := ""
	if s.Content != nil {
		seed = *s.Content
	} else if s.URI != nil {
		seed = *s.URI
	}
	sum := sha256.Sum256([]byte(seed))
	return hex.EncodeToString(sum[:])[:16]
}

type Binding struct {
	SymbolID string  `yaml:"symbol_id" json:"symbol_id"`
	SpecID   *string `yaml:"spec_id,omitempty" json:"spec_id,omitempty"`
	Spec     string  `yaml:"spec,omitempty" json:"spec,omitempty"`
}

type Case struct {
	ID       string                    `yaml:"id" json:"id"`
	Input    map[string]any            `yaml:"input,omitempty" json:"input"`
	Desc     string                    `yaml:"desc,omitempty" json:"desc,omitempty"`
	Facets   map[string]string         `yaml:"facets,omitempty" json:"facets,omitempty"`
	Requires []string                  `yaml:"requires,omitempty" json:"requires,omitempty"`
	Judge    map[string]map[string]any `yaml:"judge,omitempty" json:"judge,omitempty"`
	Binding  *Binding                  `yaml:"binding,omitempty" json:"binding,omitempty"`
}

type FacetSpec struct {
	Values  []string `yaml:"values,omitempty" json:"values,omitempty"`
	Ordered bool     `yaml:"ordered,omitempty" json:"ordered,omitempty"`
	Open    bool     `yaml:"open,omitempty" json:"open,omitempty"`
}

type CaseSet struct {
	CaseSet       string               `yaml:"caseset" json:"caseset"`
	Focus         string               `yaml:"focus,omitempty" json:"focus,omitempty"`
	FacetSchema   map[string]FacetSpec `yaml:"facets,omitempty" json:"facets,omitempty"`
	Sources       []Source             `yaml:"sources,omitempty" json:"sources,omitempty"`
	Cases         []Case               `yaml:"cases" json:"cases"`
	SchemaVersion int                  `yaml:"schema_version,omitempty" json:"schema_version"`
}

func Load(path string) (CaseSet, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return CaseSet{}, fmt.Errorf("read CaseSet %s: %w", path, err)
	}
	var wire struct {
		CaseSet       string               `yaml:"caseset"`
		Focus         string               `yaml:"focus"`
		FacetSchema   map[string]FacetSpec `yaml:"facets"`
		Sources       []Source             `yaml:"sources"`
		Cases         []Case               `yaml:"cases"`
		SchemaVersion *int                 `yaml:"schema_version"`
	}
	if err := yaml.Unmarshal(data, &wire); err != nil {
		return CaseSet{}, fmt.Errorf("parse CaseSet %s: %w", path, err)
	}
	cases := CaseSet{
		CaseSet: wire.CaseSet, Focus: wire.Focus, FacetSchema: wire.FacetSchema,
		Sources: wire.Sources, Cases: wire.Cases, SchemaVersion: SchemaVersion,
	}
	if wire.SchemaVersion != nil {
		cases.SchemaVersion = *wire.SchemaVersion
	}
	for index := range cases.Cases {
		if cases.Cases[index].Input == nil {
			cases.Cases[index].Input = map[string]any{}
		}
		if cases.Cases[index].Facets == nil {
			cases.Cases[index].Facets = map[string]string{}
		}
		if cases.Cases[index].Judge == nil {
			cases.Cases[index].Judge = map[string]map[string]any{}
		}
	}
	return cases, nil
}

func Validate(cases CaseSet) error {
	for name, facet := range cases.FacetSchema {
		if len(facet.Values) == 0 && !facet.Open {
			return fmt.Errorf("facet %q must declare non-empty values or be open", name)
		}
		if facet.Ordered && len(facet.Values) == 0 {
			return fmt.Errorf("facet %q: ordered requires values", name)
		}
	}

	sources := make(map[string]struct{}, len(cases.Sources))
	for _, source := range cases.Sources {
		if source.Name == "" {
			return fmt.Errorf("source with empty name")
		}
		if _, exists := sources[source.Name]; exists {
			return fmt.Errorf("duplicate source name: %s", source.Name)
		}
		sources[source.Name] = struct{}{}
		if (source.URI == nil) == (source.Content == nil) {
			return fmt.Errorf("source %q needs exactly one of uri or content", source.Name)
		}
	}

	seen := make(map[string]struct{}, len(cases.Cases))
	for _, item := range cases.Cases {
		if item.ID == "" {
			return fmt.Errorf("case with empty id")
		}
		if !caseIDPattern.MatchString(item.ID) {
			return fmt.Errorf("case with invalid id: %q", item.ID)
		}
		if _, exists := seen[item.ID]; exists {
			return fmt.Errorf("duplicate case id: %s", item.ID)
		}
		seen[item.ID] = struct{}{}
		for name, value := range item.Facets {
			facet, exists := cases.FacetSchema[name]
			if !exists {
				return fmt.Errorf("case %s: unknown facet %q", item.ID, name)
			}
			if !facet.Open && !slices.Contains(facet.Values, value) {
				return fmt.Errorf("case %s: facet %s=%q not in %v", item.ID, name, value, facet.Values)
			}
		}
		for _, name := range item.Requires {
			if _, exists := sources[name]; !exists {
				return fmt.Errorf("case %s: requires unknown source %q", item.ID, name)
			}
		}
		for face := range item.Judge {
			if face != "e2e" && face != "eval" && face != "perf" && face != "trace" {
				return fmt.Errorf("case %s: unknown judge face %q", item.ID, face)
			}
		}
		if item.Binding != nil && !symbolIDPattern.MatchString(item.Binding.SymbolID) {
			return fmt.Errorf("case %s: invalid binding symbol_id %q", item.ID, item.Binding.SymbolID)
		}
		if item.Binding != nil && item.Binding.SpecID != nil && !caseIDPattern.MatchString(*item.Binding.SpecID) {
			return fmt.Errorf("case %s: invalid binding spec_id %q", item.ID, *item.Binding.SpecID)
		}
	}
	return nil
}

func CaseHash(item Case) (string, error) {
	requires := slices.Clone(item.Requires)
	if requires == nil {
		requires = []string{}
	}
	slices.Sort(requires)
	var encoded bytes.Buffer
	encoder := json.NewEncoder(&encoded)
	encoder.SetEscapeHTML(false)
	err := encoder.Encode(map[string]any{
		"id": item.ID, "input": item.Input, "facets": item.Facets,
		"requires": requires, "judge": item.Judge,
	})
	if err != nil {
		return "", fmt.Errorf("marshal Case %q for hash: %w", item.ID, err)
	}
	data := bytes.TrimSuffix(encoded.Bytes(), []byte{'\n'})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])[:8], nil
}
