# PLAN: Fix Act Warnings in Tests

## Goal
Eliminate `console.error` warnings about `act(...)` wrapping in `__tests__/unit/unread_logic.test.js` by ensuring async state updates in `useRealtimeUnreadCounts` are properly awaited during tests.

**Success Criteria:**
- [ ] `npm test` runs without `console.error` warnings related to `act(...)`.
- [ ] `__tests__/unit/unread_logic.test.js` passes all tests.

## Architecture

The `useRealtimeUnreadCounts` hook triggers an asynchronous "prime cache" operation (`primeCache`) inside a `useEffect` on mount. This operation calls `setLastReadTick` after a `Promise.all` resolution. In unit tests using `renderHook`, this state update happens asynchronously after the initial render, often falling outside the test's `act` scope or occurring after assertions have already run.

To fix this, we will update the tests to explicitly wait for this side effect to complete using `waitFor` and checking that the underlying mocked function `getLastReadTimestamp` has been called.

### SDK Separation
| File | SDK | Justification |
|------|-----|---------------|
| `__tests__/unit/unread_logic.test.js` | Client | Unit tests for client-side React hooks |

## Proposed Changes

### File 1: `__tests__/unit/unread_logic.test.js` - MODIFY

**SDK:** Client

**Imports Required:**
- Update import from `../../src/lib/lastReadClient` to include `getLastReadTimestamp`.

**Note:** The same pattern needs to be applied to `__tests__/unit/unread_badge_clearing.test.js` which also uses `useRealtimeUnreadCounts`.

**Functions to Add/Modify:**
Update the test cases to import `getLastReadTimestamp` as a mock and await it.

```javascript
// Import modifications
import { 
    updateLastReadTimestamp as mockUpdateLastRead,
    getLastReadTimestamp as mockGetLastRead 
} from '../../src/lib/lastReadClient';

// In 'should not recreate listeners when lastRead changes':
it('should not recreate listeners when lastRead changes', async () => { // Make async
    // ... setup code ...

    const { unmount } = renderHook(() =>
        useRealtimeUnreadCounts('user1', 'recipient1', 'santa1'),
        { wrapper }
    );

    // [NEW] Wait for primeCache to settle
    await waitFor(() => {
        expect(mockGetLastRead).toHaveBeenCalled();
    });

    // ... rest of test ...
});

// In 'should derive unread counts from context messages':
it('should derive unread counts from context messages', async () => { // Make async
    // ... setup code ...

    const { result } = renderHook(() =>
        useRealtimeUnreadCounts('user1', 'recipient1', 'santa1'),
        { wrapper }
    );
    
    // [NEW] Wait for primeCache to settle
    await waitFor(() => {
        expect(mockGetLastRead).toHaveBeenCalled();
    });

    // ... rest of test ...
});
```

**Code Contract (Test Logic):**
1.  **Async Function Signature**: Convert `it` callbacks to `async`.
2.  **WaitFor Expectation**: Insert `await waitFor(() => expect(mockGetLastRead).toHaveBeenCalled());` immediately after `renderHook` in both affected tests.

## Verification

### Automated Tests
- Run `npm test` and verify that the console output is clean of `console.error` regarding `act`.
- Specific command: `npm test __tests__/unit/unread_logic.test.js`

### Manual QA
- None required (this is a test-only fix).

## Risk Assessment
- **Complexity: LOW** - Only modifying test wait conditions.
- **Side Effects:** None. Behavior of production code remains unchanged.
- **Flakiness:** This change is intended to *reduce* flakiness and warnings.
