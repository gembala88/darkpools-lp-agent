# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅ |

## Reporting a Vulnerability

Meridian manages Solana private keys and executes on-chain transactions. Security is our top priority.

**Do not report security vulnerabilities through public GitHub issues.**

Please report vulnerabilities privately by emailing the repository maintainers. Expect an acknowledgment within 48 hours and a detailed response within 5 business days.

### What to Include

- Type of vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### Scope

- Private key handling and storage
- RPC endpoint security
- Transaction signing and broadcasting
- API key leakage prevention
- Access control in Telegram bot

## Security Best Practices for Operators

### Private Key Management
- Use a dedicated wallet with limited funds for the agent
- Never commit `.env` files to version control
- Consider using hardware wallet or multi-sig for production deployments
- Set `DRY_RUN=true` during initial testing

### RPC Endpoints
- Use a private RPC endpoint (Helius, QuickNode, etc.)
- Avoid sharing RPC URLs with untrusted parties
- Monitor RPC usage for unusual patterns

### API Keys
- Restrict API key permissions to minimum required
- Rotate keys periodically
- Use environment variables or encrypted storage

### Telegram Bot
- Set `TELEGRAM_ALLOWED_USER_IDS` to restrict access
- Avoid sharing bot token publicly
- Monitor for unauthorized access attempts

### Risk Management
- Configure `maxPositions` and `maxDeployAmount` conservatively
- Set `outOfRangeWaitMinutes` to trigger timely rebalancing
- Review position sizing parameters regularly
- Test with `DRY_RUN=true` before live deployment

## Binaries

The project does not distribute binaries. Always build from source and verify integrity via the repository's signed releases.
