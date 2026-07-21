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
	"github.com/RudranshG07/scry/services/api-go/internal/httpapi"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

func main() {
	settings := config.Load()
	server := &http.Server{
		Addr:              settings.Address,
		Handler:           httpapi.New(store.NewMemory(), nil, settings.AllowedOrigin),
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
