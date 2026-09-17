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

	"github.com/RudranshG07/scry/services/api-go/internal/chain"
	"github.com/RudranshG07/scry/services/api-go/internal/config"
	"github.com/RudranshG07/scry/services/api-go/internal/engine"
	"github.com/RudranshG07/scry/services/api-go/internal/httpapi"
	"github.com/RudranshG07/scry/services/api-go/internal/onchain"
	"github.com/RudranshG07/scry/services/api-go/internal/store"
)

func main() {
	settings := config.Load()

	var data store.Store
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
		chains := make([]int64, 0, len(settings.Chains))
		for _, deployment := range settings.Chains {
			chains = append(chains, deployment.ID)
		}
		go engine.New(postgres.Pool(), slog.Default(), settings.ObserverPairs, chains).Run(engineCtx)

		if len(settings.Chains) == 0 {
			slog.Warn("SCRY_CHAINS is unset, so no market takes real positions.")
		} else {
			signer, err := chain.NewSigner(settings.OperatorKey)
			if err != nil {
				slog.Error("SCRY_CHAINS is set but SCRY_OPERATOR_KEY is not a usable key", "error", err)
				os.Exit(1)
			}
			for _, deployment := range settings.Chains {
				worker := onchain.New(postgres.Pool(), slog.Default(), signer, deployment)
				checking, cancel := context.WithTimeout(context.Background(), 30*time.Second)
				err := worker.Check(checking)
				cancel()
				if err != nil {
					slog.Error("chain is not ready to settle markets", "chain", deployment.ID, "error", err)
					os.Exit(1)
				}
				slog.Info("settling markets on chain", "chain", deployment.ID, "operator", signer.Address)
				go worker.Run(engineCtx)
			}
		}
	} else {
		slog.Error("SCRY_DATABASE_URL is unset, and there is nothing to serve without it.")
		os.Exit(1)
	}

	if os.Getenv("SCRY_OBSERVERS") == "" {
		slog.Warn("SCRY_OBSERVERS is unset, so every observer report will be refused.")
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
