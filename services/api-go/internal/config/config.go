package config

import (
	"os"
	"strconv"
	"strings"
)

type Chain struct {
	ID       int64
	RPC      string
	Factory  string
	Resolver string
}

type Config struct {
	Address       string
	AllowedOrigin string
	DatabaseURL   string
	ObserverPairs int
	OperatorKey   string
	Chains        []Chain
}

func Load() Config {
	return Config{
		Address:       value("SCRY_HTTP_ADDR", ":8080"),
		AllowedOrigin: value("SCRY_ALLOWED_ORIGIN", "http://127.0.0.1:3000"),
		DatabaseURL:   os.Getenv("SCRY_DATABASE_URL"),
		ObserverPairs: number("SCRY_OBSERVER_PAIRS", 1),
		OperatorKey:   strings.TrimSpace(os.Getenv("SCRY_OPERATOR_KEY")),
		Chains:        Chains(),
	}
}

// Chains lists where markets take positions: SCRY_CHAINS=84532,80002 and, for
// each, SCRY_RPC_<id>, SCRY_FACTORY_<id> and SCRY_RESOLVER_<id>.
func Chains() []Chain {
	var out []Chain
	for _, part := range strings.Split(os.Getenv("SCRY_CHAINS"), ",") {
		id, err := strconv.ParseInt(strings.TrimSpace(part), 10, 64)
		if err != nil || id <= 0 {
			continue
		}
		suffix := strconv.FormatInt(id, 10)
		out = append(out, Chain{
			ID:       id,
			RPC:      strings.TrimSpace(os.Getenv("SCRY_RPC_" + suffix)),
			Factory:  strings.TrimSpace(os.Getenv("SCRY_FACTORY_" + suffix)),
			Resolver: strings.TrimSpace(os.Getenv("SCRY_RESOLVER_" + suffix)),
		})
	}
	return out
}

func value(name string, fallback string) string {
	if current := os.Getenv(name); current != "" {
		return current
	}
	return fallback
}

func number(name string, fallback int) int {
	parsed, err := strconv.Atoi(os.Getenv(name))
	if err != nil || parsed < 1 {
		return fallback
	}
	return parsed
}
