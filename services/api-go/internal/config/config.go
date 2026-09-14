package config

import (
	"os"
	"strconv"
)

type Config struct {
	Address       string
	AllowedOrigin string
	DatabaseURL   string
	ObserverPairs int
}

func Load() Config {
	return Config{
		Address:       value("SCRY_HTTP_ADDR", ":8080"),
		AllowedOrigin: value("SCRY_ALLOWED_ORIGIN", "http://127.0.0.1:3000"),
		DatabaseURL:   os.Getenv("SCRY_DATABASE_URL"),
		ObserverPairs: number("SCRY_OBSERVER_PAIRS", 1),
	}
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
