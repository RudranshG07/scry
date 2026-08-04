package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/RudranshG07/scry/services/api-go/internal/config"
	"github.com/RudranshG07/scry/services/api-go/internal/engine"
	"github.com/RudranshG07/scry/services/api-go/internal/httpapi"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

func main() {
	settings := config.Load()

	var data store.Store = store.NewMemory()
	if settings.DatabaseURL != "" {
		startup, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		postgres, err := store.NewPostgres(startup, settings.DatabaseURL)
		cancel()
		if err != nil {
			slog.Error("Scry API could not reach the database", "error", err)
			os.Exit(1)
		}
		defer postgres.Close()
		data = postgres
		slog.Info("Scry API using Postgres")

		engineCtx, stopEngine := context.WithCancel(context.Background())
		defer stopEngine()
		go engine.New(postgres.Pool(), slog.Default()).Run(engineCtx)
	} else if os.Getenv("SCRY_USE_MEMORY_STORE") == "1" {
		slog.Warn("serving from the in-memory store; nothing here was observed")
	} else {
		// The in-memory store serves invented markets that are indistinguishable
		// from real ones over the API. Warning and carrying on has already cost
		// hours here twice, once because the variable was spelled DATABASE_URL.
		// Refusing to start is the only version that cannot be missed.
		slog.Error("SCRY_DATABASE_URL is unset. Set it, or SCRY_USE_MEMORY_STORE=1 to serve the simulator on purpose.")
		os.Exit(1)
	}

	server := &http.Server{
		Addr:              settings.Address,
		Handler:           httpapi.New(data, nil, settings.AllowedOrigin),
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}
	stopped := make(chan os.Signal, 1)
	signal.Notify(stopped, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		slog.Info("Scry API listening", "address", settings.Address)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("Scry API stopped", "error", err)
			os.Exit(1)
		}
	}()
	<-stopped
	shutdownContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownContext); err != nil {
		slog.Error("Scry API shutdown failed", "error", err)
		os.Exit(1)
	}
}
