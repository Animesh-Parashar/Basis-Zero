# AMM Test Dashboard - No Blockchain Required

This is a comprehensive testing interface for the AMM (Automated Market Maker) functionality that works directly with the database, completely bypassing blockchain interactions.

## Access

Navigate to: **`/admin/amm-test`**

Example: `http://localhost:3000/admin/amm-test`

---

## Features

### 📊 **Overview Dashboard**
- Real-time statistics: Total Markets, Sessions, Positions, Liquidity
- Visual cards with live data
- Auto-refresh capability

### 🏪 **Markets Tab**
View all prediction markets with:
- Market details (title, ID, category, status)
- Real-time prices (YES/NO)
- Probability percentages
- Reserve amounts
- Complete market state

### 👥 **Sessions Tab**
Manage trading sessions:
- View all active/closed sessions
- Click to select and view positions
- Session balance tracking
- Initial vs current balance comparison
- Nonce tracking for state updates
- View positions for each session

### 💱 **Trade Tab**
Test trading functionality:

**Place Bet:**
- Select market from dropdown
- Choose session with available balance
- Enter amount in USDC micro-units (1000000 = $1)
- Select outcome (YES or NO)
- See real-time balance validation

**Sell Position:**
- Select market with existing position
- Choose session
- Enter shares amount to sell
- Select outcome to sell
- Receive USDC back to session balance

### ➕ **Create Tab**
Add test data:

**Create Market:**
- Auto-generated or custom Market ID
- Title and description
- Category selection (Crypto, Sports, Politics, Tech, Other)
- Expiry date (defaults to 7 days)
- Initial liquidity in USDC

**Create Session:**
- Auto-generated or custom Session ID
- User address (can be fake for testing)
- Initial collateral amount
- Starts with full balance

---

## How to Use

### 1. **Setup Initial Data**

Go to **Create Tab** and:

1. **Create a Market:**
   ```
   Title: "Will Bitcoin reach $100k by March 2026?"
   Category: Crypto
   Initial Liquidity: 1000000000 (= $1000)
   ```

2. **Create a Session:**
   ```
   Initial Collateral: 5000000000 (= $5000)
   ```

### 2. **Place Your First Bet**

Go to **Trade Tab** → **Place Bet**:

1. Select the market you created
2. Select the session (shows available balance)
3. Enter amount: `100000000` (= $100)
4. Select outcome: YES or NO
5. Click "Place Bet"

**What Happens:**
- ✅ Session balance is checked
- ✅ AMM calculates shares and price impact
- ✅ Market reserves are updated
- ✅ Position is created/updated
- ✅ Session balance is deducted

### 3. **View Results**

Go to **Sessions Tab**:
- Click on your session
- See updated balance (should be $4900 if you bet $100)
- See your new position with shares

Go to **Markets Tab**:
- See updated prices based on your bet
- See changed reserves

### 4. **Sell Position**

Go to **Trade Tab** → **Sell Position**:

1. Select same market
2. Select your session
3. Enter shares to sell (from your position)
4. Select same outcome
5. Click "Sell Position"

**What Happens:**
- ✅ Shares are validated
- ✅ AMM calculates USDC payout
- ✅ Market reserves update again
- ✅ Position shares decrease
- ✅ Session balance is credited

---

## USDC Micro-Units Explained

The system uses 6 decimal places for USDC (like the real USDC token):

| Display Value | Micro-Units | Conversion |
|--------------|-------------|------------|
| $1 | 1000000 | 1 × 10^6 |
| $10 | 10000000 | 10 × 10^6 |
| $100 | 100000000 | 100 × 10^6 |
| $1000 | 1000000000 | 1000 × 10^6 |
| $5000 | 5000000000 | 5000 × 10^6 |

The UI shows the converted display value automatically: "= $X.XX USDC"

---

## Test Scenarios

### Scenario 1: Basic Bet Flow
1. Create market with $1000 liquidity (50/50 odds)
2. Create session with $5000
3. Bet $500 on YES
4. Check: Session balance = $4500
5. Check: YES price increases, NO price decreases
6. Check: Position shows ~500 YES shares

### Scenario 2: Multiple Bets
1. Use same market and session
2. Bet $200 on YES
3. Bet $200 on NO
4. Check: You have positions in both outcomes
5. Check: Session balance decreased by $400
6. Check: Prices moved based on bet direction

### Scenario 3: Sell Flow
1. Place bet to create position
2. Sell half your shares
3. Check: Position shares decreased
4. Check: Session balance increased
5. Check: Received approximately bet amount (minus slippage)

### Scenario 4: Multiple Sessions
1. Create 2-3 sessions with different balances
2. Make bets from different sessions
3. Check each session's positions independently
4. Verify balance tracking per session

### Scenario 5: Session Balance Validation
1. Create session with $100
2. Try to bet $200
3. See error: "Insufficient session balance"
4. Validates balance checking works

---

## API Endpoints Used

The test page interacts with these backend endpoints:

### Markets
- `GET /api/amm/markets` - List all markets
- `POST /api/amm/create` - Create new market
- `GET /api/amm/market/:id` - Get market details
- `GET /api/amm/quote` - Get price quote

### Trading
- `POST /api/amm/bet` - Place a bet
- `POST /api/amm/sell` - Sell position
- `GET /api/amm/position/:marketId/:userId` - Get position
- `GET /api/amm/positions/:userId` - Get all positions

### Sessions
- `GET /api/sessions` - List all sessions
- `POST /api/sessions/create` - Create session
- `GET /api/sessions/:sessionId` - Get session details
- `GET /api/sessions/user/:address` - Get user's session

---

## What Gets Tested

### ✅ Database Integration
- Market creation and storage
- Session creation and balance tracking
- Position creation and updates
- Reserve updates

### ✅ AMM Logic
- Price calculations (x * y = k)
- Slippage on large trades
- Share minting
- USDC payouts

### ✅ Balance Management
- Session balance validation
- Balance deduction on bets
- Balance credit on sells
- Insufficient balance errors

### ✅ Position Tracking
- Creating new positions
- Updating existing positions
- Multiple positions per session
- Position queries

### ✅ Error Handling
- Invalid market IDs
- Insufficient balances
- Non-existent positions
- Missing required fields

---

## Debugging Tips

### Check Browser Console
All API calls and responses are logged. Open DevTools (F12) to see:
- Request details
- Response data
- Error messages

### Check Backend Logs
If you're running the backend in terminal, you'll see:
```
[PoolManager-DB] Bet placed: session-123 bet 100000000 on YES in market-1
[PoolManager-DB] Sold: session-123 sold 50000000 YES shares in market-1
```

### Common Issues

**"Failed to fetch"**
- Backend not running on port 3001
- CORS issues (check API_BASE URL)

**"Insufficient session balance"**
- Session doesn't have enough funds
- Check current balance in Sessions tab

**"Market not found"**
- Market ID doesn't exist
- Create market first in Create tab

**"No position found"**
- Trying to sell without position
- Place bet first to create position

---

## Advantages of This Test Page

1. **No Wallet Required** - Test without MetaMask or wallet connection
2. **No Gas Fees** - Unlimited testing at no cost
3. **Instant Feedback** - See results immediately
4. **Full Control** - Create any test scenario
5. **Debug Friendly** - Clear error messages and state visibility
6. **Database Direct** - Test actual production code paths
7. **Complete View** - See all markets, sessions, positions at once

---

## Next Steps

After testing here, you can:

1. **Verify Database** - Check Supabase directly to see stored data
2. **Test Edge Cases** - Try extreme values, negative scenarios
3. **Performance Test** - Create many markets/sessions/positions
4. **Integration Test** - Connect to actual blockchain after verifying logic
5. **Export Data** - Use test data for documentation/demos

---

## Notes

- This page is for **testing/admin purposes only**
- Do not expose in production (add authentication if needed)
- All data is stored in your database
- Sessions are independent from blockchain sessions
- You can reset data by clearing database tables

---

## Example Test Flow (Complete)

```
1. Go to /admin/amm-test

2. Create Tab:
   - Create Market: "BTC > $100k?"
   - Initial Liquidity: 1000000000 ($1000)
   - ✅ Success: Market created

3. Create Tab:
   - Create Session
   - Initial Collateral: 5000000000 ($5000)
   - ✅ Success: Session created

4. Markets Tab:
   - See new market
   - YES: $0.500 (50%)
   - NO: $0.500 (50%)
   - Reserves: 1000 / 1000

5. Trade Tab → Place Bet:
   - Market: BTC > $100k?
   - Session: [your session]
   - Amount: 100000000 ($100)
   - Outcome: YES
   - ✅ Bet placed! Shares: ~198

6. Sessions Tab:
   - Click your session
   - Balance: $4900 (was $5000)
   - Position: 198 YES shares @ $0.505

7. Markets Tab:
   - YES: $0.523 (52%)
   - NO: $0.477 (48%)
   - Your bet moved the price!

8. Trade Tab → Sell Position:
   - Market: BTC > $100k?
   - Session: [your session]
   - Amount: 100000000 (100 shares)
   - Outcome: YES
   - ✅ Position sold! USDC: ~$52

9. Sessions Tab:
   - Balance: $4952 (gained $52)
   - Position: 98 YES shares remaining

10. Success! 🎉
    - AMM working ✅
    - Database synced ✅
    - Balances tracked ✅
```

---

Enjoy testing! 🚀
