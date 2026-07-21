package config

import "os"

type Config struct {
	Address       string
	AllowedOrigin string
}

func Load() Config {
	return Config{
		Address:       value("SCRY_HTTP_ADDR", ":8080"),
		AllowedOrigin: value("SCRY_ALLOWED_ORIGIN", "http://127.0.0.1:3000"),
	}
}

func value(name string, fallback string) string {
	if current := os.Getenv(name); current != "" {
		return current
	}
	return fallback
}
