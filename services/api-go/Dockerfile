# The API and the engine in one static binary. Distroless, so the image carries no
# shell, and the operator key only ever lives in the environment it starts with.
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/scry-api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/scry-api /usr/local/bin/scry-api
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/scry-api"]
