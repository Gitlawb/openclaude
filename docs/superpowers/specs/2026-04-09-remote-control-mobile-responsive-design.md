# Remote Control Mobile Responsive Design

## Summary
Make the remote-control web UI fully usable on mobile devices without changing the desktop flow. Keep the existing desktop sidebar layout, but add a mobile-only responsive mode where the sessions list moves into a hamburger-triggered drawer and the terminal becomes the primary full-width content area.

## Goals
- Make the remote-control page usable on mobile phones.
- Prevent the terminal area from breaking the layout on narrow screens.
- Keep session switching and session creation available on mobile.
- Limit the change set to layout and interaction updates around the existing UI.
- Preserve current desktop behavior as much as possible.

## Non-Goals
- No tabbed mobile session UI in this phase.
- No redesign of the desktop information architecture.
- No new remote-control backend behavior.
- No change to the existing session model or websocket protocol.
- No broader visual refresh beyond what is needed for mobile compatibility.

## Current State
The current page is rendered from `src/web/static/index.html` and uses a fixed two-column layout:
- a left sidebar for sessions and the new-session action
- a right main column for the top bar and xterm terminal

This works on desktop, but on mobile the fixed sidebar width and main column compete for horizontal space. The terminal then renders into a width that is too small, causing visible breakage and unreadable content.

## Proposed Approach
Add a mobile-only responsive layout mode at a small-screen breakpoint.

### Desktop behavior
Desktop should remain effectively unchanged:
- sidebar stays visible on the left
- terminal stays in the main column
- existing controls remain where they are

### Mobile behavior
On mobile screens:
- the fixed sidebar is hidden by default
- a hamburger button appears in the top bar
- tapping the hamburger opens a left-side drawer overlay
- the drawer contains the sessions list and the new-session button
- selecting a session closes the drawer and shows the terminal
- the terminal occupies the main visible area below the top bar
- the layout becomes strictly single-column

This is the lowest-effort path because it preserves the current structure and mostly changes layout behavior instead of introducing a new navigation model.

## Layout Design

### Breakpoint strategy
Introduce a mobile breakpoint for narrow screens. Below that breakpoint, enable the mobile layout rules. Above it, keep the current desktop structure.

### Top bar changes
In mobile mode, the top bar should:
- include a hamburger button at the leading edge
- continue showing the active session title
- keep secondary actions compact so they do not force overflow

### Sessions drawer
The mobile drawer should:
- slide in from the left as an overlay
- sit above the main content
- include the current sessions list
- highlight the active session
- include the existing `+ New session` action
- close when a session is selected
- close when the user taps outside it or uses the hamburger again

A dimmed backdrop should sit behind the open drawer so the interaction is clear and accidental terminal input is avoided while the drawer is open.

### Main content area
In mobile mode, the main content should:
- use the full available viewport width
- avoid any side-by-side composition with the sessions panel
- allow the terminal container to shrink correctly inside flex layouts
- avoid extra horizontal padding that steals usable terminal width

## Terminal Behavior
The terminal is the most important part of the mobile experience and should be treated as the primary surface.

Requirements:
- terminal width should match the available mobile content width
- terminal area should fill the remaining height under the top bar
- page-level horizontal overflow must be prevented
- terminal scroll behavior must remain usable
- the layout must not crop the terminal because of fixed heights, overflow mistakes, or multi-column constraints

The design should prefer stable container sizing over ad hoc pixel tweaks. The key requirement is that the xterm host gets a predictable width and height in mobile mode.

## Interaction Rules
- Desktop and mobile use the same session data and selection flow.
- Opening the drawer does not change the active session.
- Selecting a session changes the active session and closes the drawer.
- Creating a new session from the drawer follows the existing modal flow.
- If there is no active session, the empty state remains visible in the main area.
- Mobile-only controls should disappear once the layout returns to desktop breakpoint widths.

## Error Handling and Edge Cases
- Long session labels or paths must not stretch the mobile layout horizontally.
- The top bar must not overflow when the session title is long.
- If the drawer content becomes taller than the screen, it should scroll internally.
- Modal interactions must still work when launched from mobile.
- The layout should tolerate browser UI changes on mobile without leaving unreachable content at the bottom of the screen.

## Testing Strategy

### Manual verification
Validate at representative mobile widths:
- page loads without horizontal layout breakage
- hamburger button appears only on mobile
- drawer opens and closes correctly
- session switching works from the drawer
- new-session action remains accessible
- terminal remains readable and interactive
- desktop layout still behaves as before

### Regression focus
Pay extra attention to:
- xterm sizing after viewport changes
- switching between mobile and desktop widths
- long titles and long working-directory paths
- modal layering with drawer and terminal

## Acceptance Criteria
- On mobile, the sidebar is no longer permanently visible.
- On mobile, a hamburger button opens a sessions drawer.
- On mobile, the terminal occupies the main content area without the current broken narrow layout.
- Users can switch sessions and create new sessions from the drawer.
- Long text no longer breaks the page horizontally.
- Desktop behavior remains effectively unchanged.

## Implementation Notes
The expected changes should remain localized to the current static web UI in `src/web/static/index.html`. The implementation should favor responsive CSS and small UI state additions over structural rewrites.
