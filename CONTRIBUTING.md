# Contributing to ZEmu Launcher

Thank you for your interest in contributing to ZEmu Launcher. Please read this guide carefully before submitting any changes.

## Code of Conduct

We are committed to a welcoming and respectful environment for everyone. Harassment, discrimination, or hostile behaviour will not be tolerated.

## Contributor License Agreement

**Before your first pull request can be merged, you must sign the Contributor License Agreement (CLA).**

The CLA is in [CONTRIBUTOR_LICENSE_AGREEMENT.md](CONTRIBUTOR_LICENSE_AGREEMENT.md) in the repository root. By submitting a pull request you confirm that you have read, understood, and agree to be bound by it.

If you are unable to agree to the CLA (for example, if your employer owns rights to your contributions), please open an issue before submitting a pull request so we can find a solution.

## How to Contribute

### 1. Fork and clone

```bash
# Fork the repo on GitHub, then:
git clone https://github.com/YOUR_USERNAME/zemu-launcher.git
cd zemu-launcher
```

### 2. Set up your environment

```bash
npm install
cp .env.example .env.local
```

### 3. Create a branch

We use a `type/description` naming convention:

```bash
git checkout -b fix/friends-panel-stale-data
git checkout -b feat/discord-rich-presence
git checkout -b refactor/steamcmd-auth-flow
```

### 4. Make your changes

- Write clear, descriptive commit messages.
- Keep changes focused and atomic. One feature or fix per pull request.
- Follow the existing code style (enforced by ESLint + Prettier).
- Add TypeScript types for all new interfaces and functions.

### 5. Test your changes

```bash
# Run all linting
npm run lint

# Run all type checks
npm run typecheck

# Start the app in development mode
npm run dev
```

### 6. Submit a pull request

- Fill in the PR template completely.
- Reference any related issues (`Fixes #123`).
- Ensure all CI checks pass.
- Confirm you have read and agreed to the CLA.

## What we accept

- Bug fixes with tests
- Performance improvements
- Accessibility improvements (WCAG 2.1 AA)
- Documentation improvements
- New features that benefit the majority of users

## What we don't accept

- Changes that break existing functionality without a migration path
- Contributions under a different licence than the project licence
- Substantial contributions without a signed CLA
- Spam, duplicate PRs, or mass-reformatting without semantic purpose

## Code style

We use automated tooling for consistency. Run before committing:

```bash
npm run format    # formats all code with Prettier
npm run lint     # checks with ESLint
npm run typecheck # TypeScript compiler check
```

## Reporting security vulnerabilities

**Do NOT open a public GitHub issue for security vulnerabilities.**

Please see [SECURITY.md](SECURITY.md) for how to report vulnerabilities responsibly.

## Getting help

- Open a [GitHub Discussion](https://github.com/Splicho/zemu-launcher/discussions) for questions.
- Open an issue for bugs or feature requests.
