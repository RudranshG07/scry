package config

import "os"

type Config struct {
	Address       string
	AllowedOrigin string
	DatabaseURL   string
}

func Load() Config {
	return Config{
		Address:       value("SCRY_HTTP_ADDR", ":8080"),
		AllowedOrigin: value("SCRY_ALLOWED_ORIGIN", "http://127.0.0.1:3000"),
		DatabaseURL:   os.Getenv("SCRY_DATABASE_URL"),
	}
}

func value(name string, fallback string) string {
	if current := os.Getenv(name); current != "" {
		return current
	}
	return fallback
}
