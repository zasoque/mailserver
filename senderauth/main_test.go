package main

import (
	"bufio"
	"strings"
	"testing"
)

func TestParseSingleFrom(t *testing.T) {
	allowed := map[string]string{
		"alice@zasoque.org":                   "alice@zasoque.org",
		"Alice <alice@zasoque.org>":           "alice@zasoque.org",
		"\"Doe, Alice\" <alice@zasoque.org>":  "alice@zasoque.org",
		"\"Team: Alice\" <alice@zasoque.org>": "alice@zasoque.org",
		"Alice (comment) <alice@zasoque.org>": "alice@zasoque.org",
		"앨리스 <ALICE@ZASOQUE.ORG>":             "alice@zasoque.org",
	}
	for input, expected := range allowed {
		actual, err := parseSingleFrom(input)
		if err != nil || actual != expected {
			t.Fatalf("parse %q: got %q, %v", input, actual, err)
		}
	}
	for _, input := range []string{"", "alice@zasoque.org, bob@zasoque.org", "Friends: alice@zasoque.org;", "broken <", "user@example.com"} {
		if _, err := parseSingleFrom(input); err == nil {
			t.Fatalf("expected rejection for %q", input)
		}
	}
}

func TestMalformedOwnershipMapFailsClosed(t *testing.T) {
	for _, source := range []string{
		"broken\n",
		"alice@zasoque.org alice@zasoque.org extra\n",
		"alice@zasoque.org alice@zasoque.org\nalice@zasoque.org alice@zasoque.org\n",
		"alice@zasoque.org alice@zasoque.org\nalice@zasoque.org bob@zasoque.org\n",
		"user@example.com alice@zasoque.org\n",
	} {
		if _, err := parseOwnershipMap(bufio.NewScanner(strings.NewReader(source))); err == nil {
			t.Fatalf("expected malformed map rejection for %q", source)
		}
	}
}

func TestNormalizeAddress(t *testing.T) {
	for _, input := range []string{"fake@example.com", "a@zasoque.org.", "../a@zasoque.org", "ü@zasoque.org", "a/b@zasoque.org"} {
		if _, ok := normalizeAddress(input); ok {
			t.Fatalf("unexpectedly accepted %q", input)
		}
	}
}

func TestOwnershipMatrix(t *testing.T) {
	owners := map[string]string{
		"alice@zasoque.org": "alice@zasoque.org",
		"hello@zasoque.org": "alice@zasoque.org",
		"bob@zasoque.org":   "bob@zasoque.org",
		"admin@zasoque.org": "bob@zasoque.org",
	}
	for _, sender := range []string{"alice@zasoque.org", "hello@zasoque.org"} {
		if !isOwnedSender("alice@zasoque.org", sender, owners) {
			t.Fatalf("Alice should own %s", sender)
		}
	}
	for _, sender := range []string{"bob@zasoque.org", "admin@zasoque.org", "fake@zasoque.org", "user@example.com"} {
		if isOwnedSender("alice@zasoque.org", sender, owners) {
			t.Fatalf("Alice must not own %s", sender)
		}
	}
	if isOwnedSender("", "alice@zasoque.org", owners) {
		t.Fatal("missing authentication must fail closed")
	}
}
