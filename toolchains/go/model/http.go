package model

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
)

// HTTPInput is stable request intent, independent of runtime URLs and credentials.
type HTTPInput struct {
	Protocol string            `json:"protocol"`
	Method   string            `json:"method"`
	Path     *string           `json:"path,omitempty"`
	Headers  map[string]string `json:"headers,omitempty"`
	Body     *string           `json:"body,omitempty"`
}

type HTTPExpectation struct {
	Status      []int   `json:"status"`
	ContentType *string `json:"contentType,omitempty"`
}

var httpHeaderName = regexp.MustCompile("^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")

func decodeHTTP(value any, target any) error {
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}

// ValidateHTTPCase checks the protocol profile after canonical CaseSet validation.
func ValidateHTTPCase(item Case) error {
	var input HTTPInput
	if err := decodeHTTP(item.Input, &input); err != nil {
		return fmt.Errorf("invalid HTTP Case input: %w", err)
	}
	if input.Protocol != "http" {
		return fmt.Errorf("HTTP Case input.protocol must be http")
	}
	switch input.Method {
	case "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS":
	default:
		return fmt.Errorf("invalid HTTP Case method")
	}
	for _, key := range []string{"path", "body", "headers"} {
		if value, ok := item.Input[key]; ok && value == nil {
			return fmt.Errorf("invalid HTTP Case %s", key)
		}
	}
	if input.Path != nil && (!strings.HasPrefix(*input.Path, "/") || strings.HasPrefix(*input.Path, "//") || strings.ContainsFunc(*input.Path, func(r rune) bool { return r == '\\' || r < 32 || r == 127 })) {
		return fmt.Errorf("HTTP Case path must be origin-relative")
	}
	for key, value := range input.Headers {
		if !httpHeaderName.MatchString(key) || strings.ContainsAny(value, "\r\n") {
			return fmt.Errorf("invalid HTTP Case header")
		}
		switch strings.ToLower(key) {
		case "authorization", "proxy-authorization", "cookie", "host", "x-api-key":
			return fmt.Errorf("HTTP Case credentials and host belong to execution target headers")
		}
	}
	expected, exists := item.Judge["e2e"]["http"]
	if !exists {
		return nil
	}
	var criteria HTTPExpectation
	if err := decodeHTTP(expected, &criteria); err != nil {
		return fmt.Errorf("invalid HTTP Case expectation: %w", err)
	}
	if len(criteria.Status) == 0 {
		return fmt.Errorf("invalid HTTP Case expected status")
	}
	for _, status := range criteria.Status {
		if status < 100 || status > 599 {
			return fmt.Errorf("invalid HTTP Case expected status")
		}
	}
	if raw, ok := expected.(map[string]any); ok {
		if value, exists := raw["contentType"]; exists && value == nil {
			return fmt.Errorf("invalid HTTP Case expected contentType")
		}
	}
	if criteria.ContentType != nil && strings.TrimSpace(*criteria.ContentType) == "" {
		return fmt.Errorf("invalid HTTP Case expected contentType")
	}
	return nil
}
