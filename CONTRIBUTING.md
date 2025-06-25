# Contributing to Supermemory Slack Connector

We love your input! We want to make contributing to the Supermemory Slack Connector as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## 🚀 Quick Start for Contributors

### Development Setup

1. **Fork and Clone**
   ```bash
   git clone https://github.com/your-username/slack-connector.git
   cd slack-connector
   npm install
   ```

2. **Environment Setup**
   ```bash
   cp .dev.vars.example .dev.vars
   # Fill in your development credentials
   npm run setup:deployment
   ```

3. **Database Setup**
   ```bash
   npm run drizzle:migrate
   ```

4. **Start Development**
   ```bash
   npm run dev
   ```

## 📋 Development Workflow

### Before You Start
- Check the [issues](https://github.com/supermemoryai/slack-connector/issues) for existing work
- For major changes, please open an issue first to discuss what you would like to change
- Ensure you understand the [architecture](#architecture) before making changes

### Making Changes

1. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/your-bug-fix
   # or 
   git checkout -b docs/your-documentation-update
   ```

2. **Code Your Changes**
   - Follow our [coding standards](#coding-standards)
   - Add tests for new functionality
   - Update documentation as needed

3. **Test Your Changes**
   ```bash
   npm test                    # Run unit tests
   npm run lint               # Check code style
   npx tsc --noEmit          # Type check
   npm run dev               # Test locally
   ```

4. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "feat: add amazing new feature"
   # Use conventional commit format (see below)
   ```

5. **Push and Pull Request**
   ```bash
   git push origin feature/your-feature-name
   # Then create a Pull Request via GitHub UI
   ```

## 📝 Coding Standards

### TypeScript Guidelines
- Use strict TypeScript configuration
- Prefer interfaces over types for object shapes
- Use meaningful variable and function names
- Add JSDoc comments for public APIs

```typescript
/**
 * Transforms a Slack message into Supermemory format
 * @param message - The Slack message to transform
 * @param channelName - Name of the channel for context
 * @returns Transformed message for Supermemory API
 */
export function transformMessage(
  message: SlackMessage, 
  channelName: string
): SupermemoryPayload {
  // Implementation
}
```

### Code Style
- Use Biome for formatting (configured in `biome.json`)
- Prefer `const` over `let` when possible
- Use async/await over Promises
- Handle errors explicitly

```typescript
// Good
try {
  const result = await slackClient.getUser(userId);
  return result;
} catch (error) {
  logger.error('Failed to fetch user', { userId, error });
  throw new Error(`User fetch failed: ${error.message}`);
}

// Avoid
slackClient.getUser(userId).then(result => {
  return result;
}).catch(err => {
  throw err;
});
```

### Project Structure
- Keep files focused and small
- Use barrel exports in `index.ts` files
- Group related functionality in directories
- Separate concerns (API, DB, utils, types)

## 🧪 Testing Guidelines

### Writing Tests
- Write tests for all new functionality
- Use descriptive test names
- Test both success and error cases
- Mock external dependencies

```typescript
describe('SlackDatabase', () => {
  describe('storeOAuthData', () => {
    it('should encrypt and store valid OAuth data', async () => {
      // Test implementation
    });

    it('should throw error for invalid OAuth response', async () => {
      // Test implementation
    });
  });
});
```

### Test Categories
- **Unit Tests**: Test individual functions/classes
- **Integration Tests**: Test component interactions
- **E2E Tests**: Test complete workflows

### Running Tests
```bash
npm test                           # All tests
npm test -- slackDatabase.spec.ts # Specific file
npm test -- --watch              # Watch mode
```

## 📐 Architecture Guidelines

### Key Principles
1. **Separation of Concerns**: Keep business logic separate from infrastructure
2. **Error Handling**: Always handle errors gracefully
3. **Security First**: Encrypt sensitive data, verify requests
4. **Rate Limiting**: Respect API limits
5. **Observability**: Log important events

### Adding New Features

#### New Slack Event Handler
1. Add event type to `SlackEventPayload` in `types/index.ts`
2. Create handler in `slack/handlers/`
3. Register handler in `slack/index.ts`
4. Add tests for the handler
5. Update documentation

#### New Database Operation
1. Add function to `db/slackOperations.ts`
2. Update schema if needed in `db/schema.ts`
3. Generate migration: `npm run drizzle:generate`
4. Add tests in `test/slackDatabase.spec.ts`

#### New API Endpoint
1. Add route to appropriate router
2. Implement request/response types
3. Add rate limiting if needed
4. Add authentication if required
5. Document in README API section

## 🎯 Commit Message Format

We use [Conventional Commits](https://www.conventionalcommits.org/) for clear history:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to build process or auxiliary tools

### Examples
```bash
feat(auth): add Slack OAuth token rotation
fix(rate-limit): handle 429 responses correctly
docs(readme): update installation instructions
test(database): add tests for token encryption
```

## 🔍 Pull Request Process

### Before Submitting
- [ ] Tests pass locally
- [ ] Code follows style guidelines
- [ ] Documentation is updated
- [ ] No TypeScript errors
- [ ] Commit messages follow convention

### PR Description Template
```markdown
## Summary
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
- [ ] Unit tests added/updated
- [ ] Integration tests pass
- [ ] Manual testing completed

## Checklist
- [ ] Code follows project style guidelines
- [ ] Self-review completed
- [ ] Documentation updated
- [ ] Tests added for new functionality
```

### Review Process
1. **Automated Checks**: CI/CD pipeline runs tests and linting
2. **Code Review**: Maintainer reviews for quality and correctness
3. **Testing**: Changes are tested in staging environment
4. **Merge**: Approved changes are merged to main branch

## 🐛 Bug Reports

### Before Reporting
- Check if the issue already exists
- Try to reproduce with minimal steps
- Test with the latest version

### Bug Report Template
```markdown
**Describe the Bug**
Clear description of what the bug is.

**To Reproduce**
Steps to reproduce the behavior:
1. Go to '...'
2. Click on '....'
3. See error

**Expected Behavior**
What you expected to happen.

**Environment**
- OS: [e.g. macOS, Ubuntu]
- Node.js version: [e.g. 18.17.0]
- Wrangler version: [e.g. 3.15.0]
- Browser: [if applicable]

**Additional Context**
Add any other context about the problem here.
```

## 💡 Feature Requests

### Before Requesting
- Check if the feature already exists or is planned
- Consider if it fits the project's scope
- Think about implementation complexity

### Feature Request Template
```markdown
**Is your feature request related to a problem?**
Clear description of what the problem is.

**Describe the solution you'd like**
Clear description of what you want to happen.

**Describe alternatives you've considered**
Other solutions you've considered.

**Additional context**
Any other context about the feature request.
```

## 🎨 Documentation

### Types of Documentation
- **README**: Project overview and quick start
- **API Documentation**: Endpoint descriptions and examples
- **Architecture Documentation**: System design and decisions
- **Deployment Guide**: Setup and configuration instructions

### Writing Guidelines
- Use clear, concise language
- Include code examples
- Keep documentation up-to-date with code changes
- Use consistent formatting

## 📞 Getting Help

- **Discord**: Join our [community server](https://discord.gg/supermemory)
- **GitHub Issues**: For bugs and feature requests
- **GitHub Discussions**: For questions and general discussion
- **Email**: For private inquiries - support@supermemory.ai

## 📜 Code of Conduct

### Our Pledge
We pledge to make participation in our project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Standards
- Be respectful and inclusive
- Exercise empathy and kindness
- Focus on what is best for the community
- Show grace when receiving feedback

### Enforcement
Instances of abusive, harassing, or otherwise unacceptable behavior may be reported to the community leaders responsible for enforcement at conduct@supermemory.ai.

## 🙏 Recognition

Contributors who make significant improvements will be:
- Added to the contributors list
- Mentioned in release notes
- Invited to join the maintainer team (for ongoing contributors)

Thank you for contributing to Supermemory Slack Connector! 🎉 