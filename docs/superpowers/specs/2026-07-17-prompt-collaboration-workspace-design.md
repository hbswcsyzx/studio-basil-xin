# Prompt Collaboration Workspace Design

## Scope

Improve only the inline prompt-collaboration workspace. The parent image workspace, main prompt, selected references, style preset, and image settings remain unchanged.

## Behavior

- A compact `New conversation` action permanently deletes all prompt-collaboration messages for the current user and workspace after confirmation.
- The collaboration message list clears immediately after a successful reset. A later request starts with no prior collaboration context.
- The composer grows with its content up to a practical limit and remains manually vertically resizable.
- User and assistant messages use content-sized rows. A single first message never stretches to fill the history viewport.
- The history scrolls to the newest content when history loads, when a user sends a message, and when the assistant reply arrives.
- Reset and send failures use the existing persistent error notification system.

## Architecture

The backend adds an authenticated `DELETE /api/workspaces/{workspace_id}/prompt-collaboration` endpoint scoped by both workspace and user. The existing React component owns reset confirmation, textarea sizing, optimistic display of the outgoing user message, and scroll positioning. CSS controls compact message rows and composer resize limits.

## Testing

- Backend API test proves reset deletes only collaboration messages and leaves the workspace usable.
- Frontend tests prove reset confirmation and deletion, content-sized/resizable composition semantics, optimistic outgoing display, and automatic scroll behavior.
- Run the complete frontend and backend suites, production build, deployment health check, and browser acceptance test.
