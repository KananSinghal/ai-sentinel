.PHONY: help build up down logs test lint deploy clean install-deps

help:
	@echo "AI-Sentinel Project Commands"
	@echo "============================"
	@echo "make build          - Build all Docker images"
	@echo "make up             - Start all services"
	@echo "make down           - Stop all services"
	@echo "make logs           - View logs"
	@echo "make test           - Run tests"
	@echo "make install-deps   - Install all dependencies"

build:
	docker-compose build

up:
	docker-compose up -d

down:
	docker-compose down

logs:
	docker-compose logs -f

test:
	cd services/user-service && npm test
	cd services/ml-service && pytest tests/ -v

install-deps:
	cd services/user-service && npm install
	cd services/disaster-service && npm install
	cd services/websocket-server && npm install
	cd services/ml-service && pip install -r requirements.txt
	cd frontend && npm install

clean:
	docker-compose down -v --remove-orphans
	docker system prune -f

ps:
	docker-compose ps
