# Contributing to Meridian

We welcome contributions! Please follow these guidelines.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/meridian.git`
3. Install dependencies: `npm install`
4. Create a branch: `git checkout -b feature/your-feature-name`

## Development Workflow

### Setup

```bash
npm install
cp .env.example .env
# Fill in required keys in .env
```

### Code Quality

```bash
npm run lint        # TypeScript type checking
npm run build       # Compile TypeScript to dist/
npm test            # Run Vitest test suite
npm run test:watch  # Watch mode for TDD
```

### Project Structure

```
meridian/
├── index.js              # Main entry point
├── agent.js              # LLM ReAct loop
├── config.js             # Runtime configuration
├── tools/                # Agent-accessible tool implementations
│   ├── definitions.js    # Tool schemas (OpenAI format)
│   ├── executor.js       # Tool dispatch and safety checks
│   ├── dlmm.js           # Meteora DLMM operations
│   ├── screening.js      # Pool discovery
│   └── ...
├── src/                  # TypeScript engine subsystem
│   ├── engines/          # Analysis engines
│   ├── repositories/     # Data repositories
│   ├── integrations/     # External API adapters
│   ├── services/         # Orchestration services
│   └── filters/          # Deployment filters
└── tests/                # Vitest test suite
```

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Ensure TypeScript compiles: `npm run build`
3. Update CHANGELOG.md with your changes under "Unreleased"
4. Submit a PR against the `main` branch
5. Add a clear description of the change and its motivation

## Code Style

- Follow existing patterns in the codebase
- Use TypeScript for new engine/repository code
- Use JSDoc for public API surfaces in tools/
- Keep functions focused and small
- No commented-out code or `console.log` debugging

## Adding a New Engine

1. Create the engine file in `src/engines/`
2. Extend `BaseEngine` and implement `evaluate()`
3. Add to `src/engines/index.ts` barrel export
4. Register in `LpAlphaScoreEngine` engine list
5. Add tests in `tests/engines/`

## Adding a New Tool

1. Add schema to `tools/definitions.js`
2. Add implementation to `tools/executor.js`
3. Add to appropriate role set in `agent.js`
4. If it writes on-chain state, add to `WRITE_TOOLS` in executor.js

## Reporting Issues

- Use the GitHub issue tracker
- Include the full error output and steps to reproduce
- Mark sensitive information (API keys, wallet addresses)

## Security

- Never commit `.env` files or private keys
- Report security issues privately via the repository's security policy
