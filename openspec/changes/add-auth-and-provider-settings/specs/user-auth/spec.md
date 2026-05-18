## ADDED Requirements

### Requirement: Local login session
The system SHALL allow users to submit a local username/password registration, sign in after approval, and sign out, and SHALL expose the authenticated user identity to Server Components and Route Handlers.

#### Scenario: User creates a local account
- **WHEN** an unauthenticated user submits an unused username and password
- **THEN** the system stores the local user account with `status = pending` and does not establish an authenticated session

#### Scenario: User registers with an existing username
- **WHEN** an unauthenticated user submits a username that already exists
- **THEN** the system rejects the registration and shows a duplicate username message

#### Scenario: User signs in with local credentials
- **WHEN** an unauthenticated approved user submits a valid username and password
- **THEN** the system establishes an authenticated session for the matching local user

#### Scenario: Pending user attempts sign in
- **WHEN** an unauthenticated pending user submits a valid username and password
- **THEN** the system rejects sign in and shows a pending approval message

#### Scenario: Rejected user attempts sign in
- **WHEN** an unauthenticated rejected user submits a valid username and password
- **THEN** the system rejects sign in and shows a rejected registration message

#### Scenario: User signs out
- **WHEN** an authenticated user chooses sign out
- **THEN** the system ends the active session and returns the user to an unauthenticated state

### Requirement: Admin user review
The system SHALL treat username `koiyoho` as the fixed administrator and SHALL allow only that administrator to approve or reject pending users.

#### Scenario: Database initialization marks admin
- **WHEN** database initialization runs and a user with username `koiyoho` exists
- **THEN** the system marks that user as `role = admin` and `status = approved`

#### Scenario: Admin reviews pending user with API authorization
- **WHEN** `koiyoho` approves a pending user and enables current API authorization
- **THEN** the system sets the user to `approved`, records approval metadata, and sets `canUseAdminProvider = true`

#### Scenario: Admin reviews pending user without API authorization
- **WHEN** `koiyoho` approves a pending user without current API authorization
- **THEN** the system sets the user to `approved`, records approval metadata, and leaves `canUseAdminProvider = false`

#### Scenario: Admin rejects pending user
- **WHEN** `koiyoho` rejects a pending user
- **THEN** the system sets the user to `rejected`, records the reviewer, and clears `canUseAdminProvider`

#### Scenario: Regular user calls review API
- **WHEN** a non-admin user calls the user review API
- **THEN** the system rejects the request and leaves pending users unchanged

### Requirement: Protected pages
The system SHALL require an authenticated session before showing the board list or an individual board workspace.

#### Scenario: Unauthenticated user opens board list
- **WHEN** a request without an authenticated session opens the home board list
- **THEN** the system shows the login entry or redirects to the login page instead of returning board data

#### Scenario: Authenticated user opens board list
- **WHEN** a request with an authenticated session opens the home board list
- **THEN** the system returns only boards owned by the authenticated user

### Requirement: API authentication
The system SHALL reject mutating and data-reading API requests that require user data when no authenticated session is present.

#### Scenario: Unauthenticated API request
- **WHEN** a request without an authenticated session calls a protected board, asset, export, snapshot, duplicate, or generation endpoint
- **THEN** the system returns an authentication error and performs no data mutation

#### Scenario: Authenticated API request
- **WHEN** a request with an authenticated session calls a protected endpoint with valid input
- **THEN** the system evaluates the request against the authenticated user's data ownership before returning or mutating data

### Requirement: User-owned boards
The system SHALL associate every board with exactly one user and SHALL scope board list, board detail, update, duplicate, delete, snapshot, upload, export, and generation operations to the board owner.

#### Scenario: User accesses own board
- **WHEN** an authenticated user requests a board owned by that user
- **THEN** the system allows the operation when the request payload is valid

#### Scenario: User accesses another user's board
- **WHEN** an authenticated user requests a board owned by another user
- **THEN** the system returns a not found or access denied response and performs no mutation

### Requirement: Local data migration ownership
The system SHALL provide a deterministic local migration or initialization path for assigning existing local boards to a user when authentication is introduced.

#### Scenario: Existing local boards are migrated
- **WHEN** the local database contains boards without a user owner during the auth upgrade
- **THEN** the system assigns those boards to the deterministic `local-default-user` and does not migrate them to `koiyoho`
