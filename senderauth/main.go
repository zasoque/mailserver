package main

import (
	"bufio"
	"errors"
	"fmt"
	"log"
	"net"
	"net/mail"
	"net/textproto"
	"os"
	"strings"
	"syscall"

	"github.com/emersion/go-milter"
)

const (
	listenAddress = "127.0.0.1:10029"
	ownershipPath = "/usr/local/var/zasoque-mailadmin/postfix/sender_login"
)

type senderAuthMilter struct{ milter.NoOpMilter }

func (s *senderAuthMilter) Headers(headers textproto.MIMEHeader, modifier *milter.Modifier) (milter.Response, error) {
	authenticated, ok := normalizeAddress(modifier.Macros["{auth_authen}"])
	if !ok {
		log.Printf("reject: missing or invalid authenticated identity")
		return milter.RespReject, nil
	}
	fromValues := headers.Values("From")
	if len(fromValues) != 1 {
		log.Printf("reject: invalid From header count for authenticated identity %q", authenticated)
		return milter.RespReject, nil
	}
	from, err := parseSingleFrom(fromValues[0])
	if err != nil {
		log.Printf("reject: invalid From header for authenticated identity %q", authenticated)
		return milter.RespReject, nil
	}
	owners, err := loadOwnershipMap(ownershipPath)
	if err != nil {
		log.Printf("temporary failure: sender ownership map unavailable or invalid")
		return milter.RespTempFail, nil
	}
	if !isOwnedSender(authenticated, from, owners) {
		log.Printf("reject: visible sender %q is not owned by authenticated identity %q", from, authenticated)
		return milter.RespReject, nil
	}
	return milter.RespContinue, nil
}

func isOwnedSender(authenticated, sender string, owners map[string]string) bool {
	return authenticated != "" && sender != "" && owners[sender] == authenticated
}

func parseSingleFrom(value string) (string, error) {
	if hasGroupSyntax(value) {
		return "", errors.New("group syntax is not allowed")
	}
	address, err := mail.ParseAddress(value)
	if err != nil {
		return "", errors.New("From must contain exactly one mailbox")
	}
	normalized, ok := normalizeAddress(address.Address)
	if !ok {
		return "", errors.New("unsupported sender address")
	}
	return normalized, nil
}

// This only rejects group delimiters outside quoted strings, comments, and
// angle addresses. net/mail remains responsible for parsing the mailbox.
func hasGroupSyntax(value string) bool {
	quoted, escaped, angleDepth, commentDepth := false, false, 0, 0
	for _, character := range value {
		if escaped {
			escaped = false
			continue
		}
		if character == '\\' && (quoted || commentDepth > 0) {
			escaped = true
			continue
		}
		if commentDepth > 0 {
			if character == '(' {
				commentDepth++
			} else if character == ')' {
				commentDepth--
			}
			continue
		}
		if !quoted && character == '(' {
			commentDepth = 1
			continue
		}
		if character == '"' {
			quoted = !quoted
			continue
		}
		if quoted {
			continue
		}
		if character == '<' {
			angleDepth++
		} else if character == '>' && angleDepth > 0 {
			angleDepth--
		} else if angleDepth == 0 && (character == ':' || character == ';') {
			return true
		}
	}
	return false
}

func normalizeAddress(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	parts := strings.Split(value, "@")
	if len(parts) != 2 || parts[1] != "zasoque.org" || len(parts[0]) < 1 || len(parts[0]) > 64 {
		return "", false
	}
	for _, character := range parts[0] {
		if !((character >= 'a' && character <= 'z') || (character >= '0' && character <= '9') || strings.ContainsRune("._-", character)) {
			return "", false
		}
	}
	return value, true
}

func loadOwnershipMap(sourcePath string) (map[string]string, error) {
	info, err := os.Lstat(sourcePath)
	if err != nil || !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm() != 0640 {
		return nil, errors.New("unsafe map")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Uid != 0 || stat.Gid != uint32(os.Getgid()) {
		return nil, errors.New("unsafe ownership")
	}
	file, err := os.Open(sourcePath)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	return parseOwnershipMap(bufio.NewScanner(file))
}

func parseOwnershipMap(scanner *bufio.Scanner) (map[string]string, error) {
	result := make(map[string]string)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) != 2 {
			return nil, errors.New("malformed map")
		}
		sender, senderOK := normalizeAddress(fields[0])
		owner, ownerOK := normalizeAddress(fields[1])
		if !senderOK || !ownerOK {
			return nil, errors.New("invalid address")
		}
		if existing, duplicate := result[sender]; duplicate && existing != owner {
			return nil, errors.New("conflicting ownership")
		}
		if _, duplicate := result[sender]; duplicate {
			return nil, errors.New("duplicate ownership")
		}
		result[sender] = owner
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func main() {
	if len(os.Args) == 2 && os.Args[1] == "--check-config" {
		if _, err := loadOwnershipMap(ownershipPath); err != nil {
			log.Fatal("sender authorization configuration is unsafe or invalid")
		}
		log.Print("sender authorization configuration verified")
		return
	}
	if len(os.Args) != 1 {
		log.Fatal("usage: senderauth [--check-config]")
	}
	listener, err := net.Listen("tcp4", listenAddress)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("sender authorization milter listening on %s", listenAddress)
	server := milter.Server{NewMilter: func() milter.Milter { return &senderAuthMilter{} }, Actions: 0, Protocol: milter.OptNoConnect | milter.OptNoHelo | milter.OptNoMailFrom | milter.OptNoRcptTo | milter.OptNoBody}
	if err := server.Serve(listener); err != nil && err != milter.ErrServerClosed {
		log.Fatal(fmt.Errorf("milter server failed: %w", err))
	}
}
