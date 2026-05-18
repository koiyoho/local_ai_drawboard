## ADDED Requirements

### Requirement: User provider setting
The system SHALL allow each authenticated user to create, update, read, and disable one active OpenAI-compatible image provider setting.

#### Scenario: User saves provider setting
- **WHEN** an authenticated user submits a provider display name, API key, optional base URL, and image model
- **THEN** the system persists the setting for that authenticated user and does not expose the API key in the response

#### Scenario: User reads provider setting
- **WHEN** an authenticated user opens the provider settings view
- **THEN** the system returns that user's provider metadata with the API key redacted

### Requirement: Provider setting access control
The system SHALL scope provider settings to the authenticated user and SHALL prevent one user from reading or changing another user's provider setting.

#### Scenario: User requests own provider setting
- **WHEN** an authenticated user requests provider settings
- **THEN** the system returns only settings owned by that user

#### Scenario: User attempts cross-user provider access
- **WHEN** an authenticated user attempts to read, update, or disable a provider setting owned by another user
- **THEN** the system rejects the request and leaves the provider setting unchanged

### Requirement: Generation uses provider setting
The system SHALL prefer the authenticated user's active provider setting when creating AI image generation requests, and SHALL use the admin `koiyoho` active provider only when the current user is explicitly authorized and has no active provider.

#### Scenario: User generates with configured provider
- **WHEN** an authenticated user with an active provider setting submits a valid generation request
- **THEN** the system creates the OpenAI-compatible client from that user's API key, base URL, and image model

#### Scenario: Authorized user generates with admin provider
- **WHEN** an authenticated user without an active provider setting has `canUseAdminProvider = true` and submits a valid generation request
- **THEN** the system creates the OpenAI-compatible client from `koiyoho`'s active provider setting

#### Scenario: User provider takes precedence over admin provider
- **WHEN** an authenticated user has an active provider setting and also has `canUseAdminProvider = true`
- **THEN** the system uses the authenticated user's own provider setting

#### Scenario: User generates without provider setting
- **WHEN** an authenticated user without an active provider setting and without admin API authorization submits a generation request
- **THEN** the system rejects the request with a provider configuration error and does not call an external AI API

### Requirement: Provider configuration validation
The system SHALL validate provider setting input before saving and SHALL reject incomplete or invalid provider configuration.

#### Scenario: Missing API key
- **WHEN** an authenticated user submits a provider setting without an API key
- **THEN** the system returns a validation error and does not save the setting

#### Scenario: Invalid base URL
- **WHEN** an authenticated user submits a provider setting with a malformed base URL
- **THEN** the system returns a validation error and does not save the setting

### Requirement: Provider traceability
The system SHALL record provider metadata used for each generation job without exposing the provider API key.

#### Scenario: Generation job records provider metadata
- **WHEN** an authenticated user successfully starts a generation job
- **THEN** the system stores the provider identifier, owner, base URL presence, model name, and setting id or display name in generation job metadata without storing the API key in job metadata
