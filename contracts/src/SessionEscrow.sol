// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title SessionEscrow
 * @author Basis-Zero Team
 * @notice Lightweight escrow contract on Polygon Amoy.
 *         Holds session allowance for Yellow Nitrolite off-chain betting sessions.
 * 
 * Architecture:
 * - Users deposit USDC directly -> deposit()
 * - Users lock funds for a session -> openSession()
 * - Yellow Nitrolite runs off-chain session
 * - Session settles with signed PnL -> settleSession()
 * - Users withdraw available funds -> withdraw()
 */
contract SessionEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTANTS
    // ═══════════════════════════════════════════════════════════════════════════
    
    uint256 public constant BPS_DENOMINATOR = 10000;
    uint256 public constant SESSION_TIMEOUT = 24 hours;

    // ═══════════════════════════════════════════════════════════════════════════
    // ENUMS
    // ═══════════════════════════════════════════════════════════════════════════
    
    enum SessionState {
        None,       // No active session
        Active,     // Funds locked, Yellow session in progress
        Settled     // Session settled, funds returned to available balance
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // STATE VARIABLES
    // ═══════════════════════════════════════════════════════════════════════════
    
    /// @notice USDC token contract
    IERC20 public immutable USDC;
    
    /// @notice Protocol fee in basis points (e.g., 1000 = 10%)
    uint256 public protocolFeeBps;
    
    /// @notice Protocol fee recipient
    address public protocolTreasury;
    
    /// @notice Trusted Yellow Nitrolite signers
    mapping(address => bool) public trustedNitroliteSigners;
    
    /// @notice Required signatures for settlement
    uint256 public requiredSignatures;

    // ═══════════════════════════════════════════════════════════════════════════
    // USER STATE
    // ═══════════════════════════════════════════════════════════════════════════
    
    struct UserAccount {
        uint256 depositedAmount;  // Total funds deposited (Available + Locked)
        uint256 lockedAmount;     // Funds currently locked in a session
        bytes32 activeSessionId;  // Current session ID (if any)
        uint256 sessionStartTime; // When the current session started
        SessionState sessionState;
    }
    
    /// @notice User accounts
    mapping(address => UserAccount) public accounts;
    
    /// @notice Session ID to User mapping (for settling)
    mapping(bytes32 => address) public sessionUsers;

    // ═══════════════════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════════════════
    
    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    
    event SessionOpened(
        address indexed user, 
        bytes32 indexed sessionId, 
        uint256 amount
    );
    
    event SessionSettled(
        address indexed user,
        bytes32 indexed sessionId,
        int256 pnl,
        uint256 netPayout,
        uint256 protocolFee
    );
    
    event SessionTimedOut(
        address indexed user,
        bytes32 indexed sessionId,
        uint256 refundAmount
    );
    
    event NitroliteSignerUpdated(address indexed signer, bool trusted);

    // ═══════════════════════════════════════════════════════════════════════════
    // ERRORS
    // ═══════════════════════════════════════════════════════════════════════════
    
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance();
    error InvalidSessionState();
    error SessionIdMismatch();
    error UserAlreadyHasActiveSession();
    error InvalidSettlementProof();
    error InsufficientSignatures();
    error SessionNotTimedOut();
    error SessionNotFound();

    // ═══════════════════════════════════════════════════════════════════════════
    // CONSTRUCTOR
    // ═══════════════════════════════════════════════════════════════════════════
    
    constructor(
        address _usdc,
        address _treasury,
        uint256 _protocolFeeBps,
        uint256 _requiredSignatures
    ) Ownable(msg.sender) {
        if (_usdc == address(0) || _treasury == address(0)) revert ZeroAddress();
        
        USDC = IERC20(_usdc);
        protocolTreasury = _treasury;
        protocolFeeBps = _protocolFeeBps;
        requiredSignatures = _requiredSignatures;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // USER FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * @notice Deposit USDC into the vault
     * @param amount Amount to deposit
     */
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        
        USDC.safeTransferFrom(msg.sender, address(this), amount);
        
        accounts[msg.sender].depositedAmount += amount;
        
        emit Deposited(msg.sender, amount);
    }
    
    /**
     * @notice Withdraw available USDC
     * @param amount Amount to withdraw
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        
        UserAccount storage userAcc = accounts[msg.sender];
        uint256 available = userAcc.depositedAmount - userAcc.lockedAmount;
        
        if (amount > available) revert InsufficientBalance();
        
        userAcc.depositedAmount -= amount;
        USDC.safeTransfer(msg.sender, amount);
        
        emit Withdrawn(msg.sender, amount);
    }
    
    /**
     * @notice Open a new session, locking funds
     * @param amount Amount to lock for the session
     * @param sessionId Unique session ID provided by backend/client
     */
    function openSession(uint256 amount, bytes32 sessionId) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        
        UserAccount storage userAcc = accounts[msg.sender];
        
        if (userAcc.activeSessionId != bytes32(0)) revert UserAlreadyHasActiveSession();
        
        uint256 available = userAcc.depositedAmount - userAcc.lockedAmount;
        if (amount > available) revert InsufficientBalance();
        
        // Lock funds
        userAcc.lockedAmount = amount;
        userAcc.activeSessionId = sessionId;
        userAcc.sessionStartTime = block.timestamp;
        userAcc.sessionState = SessionState.Active;
        
        sessionUsers[sessionId] = msg.sender;
        
        emit SessionOpened(msg.sender, sessionId, amount);
    }
    
    /**
     * @notice Settle a session with verified Nitrolite signatures
     * @param sessionId Session to settle
     * @param pnl Final profit/loss (positive = user won, negative = user lost)
     * @param signatures Array of signatures from Nitrolite participants
     */
    function settleSession(
        bytes32 sessionId,
        int256 pnl,
        bytes[] calldata signatures
    ) external nonReentrant {
        address user = sessionUsers[sessionId];
        if (user == address(0)) revert SessionNotFound();
        
        UserAccount storage userAcc = accounts[user];
        
        if (userAcc.activeSessionId != sessionId) revert SessionIdMismatch();
        if (userAcc.sessionState != SessionState.Active) revert InvalidSessionState();
        
        // Verify signatures
        _verifySettlement(sessionId, pnl, signatures);
        
        // Resolve logic
        uint256 locked = userAcc.lockedAmount;
        uint256 payout = locked; // Start with principal
        uint256 protocolFee = 0;
        
        if (pnl >= 0) {
            // WIN: User gets Locked + Win - Fee
            // (Note: In this simplified vault, money comes from... where?
            //  In a real system, the counterparty (Yellow Node) would have deposited funds too.
            //  Or the PnL comes from a liquidity pool.
            //  For this "Yield Only" demo, funds might logically come from the accrued yield buffer or the 'House'
            //  Since we don't have a House pool here, we assume the Contract Balance covers the win. 
            //  IF contract runs out of money, user just gets what's there? 
            //  Ideally, `settleSession` should only be called if we have funds.
            //  For simplicity, we mint/transfer or assume the treasury Top-Up.)
            
            uint256 winAmount = uint256(pnl);
            
            // Fee on winnings
            protocolFee = (winAmount * protocolFeeBps) / BPS_DENOMINATOR;
            uint256 netWin = winAmount - protocolFee;
            
            payout += netWin;
            
            // Update depositedAmount to reflect new balance
            userAcc.depositedAmount += netWin;
            
            // In a real system, we'd transfer Fee to Treasury here or update bookkeeping
            if (protocolFee > 0) {
                 // We don't deduct from user deposit, we just don't credit it.
                 // But we need to ensure the contract has the funds.
                 // We assume the contract has funds.
                USDC.safeTransfer(protocolTreasury, protocolFee);
            }
        } else {
            // LOSS
            uint256 lossAmount = uint256(-pnl);
            if (lossAmount > locked) {
                // Total loss (should limit to locked amount)
                lossAmount = locked;
            }
            
            payout -= lossAmount;
            
            // Update deposited amount
            userAcc.depositedAmount -= lossAmount;
        }
        
        // Unlock
        userAcc.lockedAmount = 0;
        userAcc.activeSessionId = bytes32(0);
        userAcc.sessionState = SessionState.Settled;
        delete sessionUsers[sessionId];
        
        emit SessionSettled(user, sessionId, pnl, payout, protocolFee);
    }
    
    /**
     * @notice Emergency timeout release
     */
    function timeoutRelease(bytes32 sessionId) external nonReentrant {
        address user = sessionUsers[sessionId];
        // Allow anyone to trigger, but usually user
        if (user == address(0)) revert SessionNotFound();
        
        UserAccount storage userAcc = accounts[user];
        if (userAcc.sessionState != SessionState.Active) revert InvalidSessionState();
        
        if (block.timestamp < userAcc.sessionStartTime + SESSION_TIMEOUT) {
            revert SessionNotTimedOut();
        }
        
        // Refund locked amount
        uint256 amount = userAcc.lockedAmount;
        userAcc.lockedAmount = 0;
        userAcc.activeSessionId = bytes32(0);
        userAcc.sessionState = SessionState.Settled;
        delete sessionUsers[sessionId];
        
        emit SessionTimedOut(user, sessionId, amount);
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // INTERNAL FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════

    function _verifySettlement(
        bytes32 sessionId,
        int256 pnl,
        bytes[] calldata signatures
    ) internal view {
        if (signatures.length < requiredSignatures) {
            revert InsufficientSignatures();
        }
        
        bytes32 messageHash = keccak256(abi.encodePacked(sessionId, pnl));
        bytes32 ethSignedHash = messageHash.toEthSignedMessageHash();
        
        uint256 validSignatures = 0;
        address lastSigner = address(0);
        
        for (uint256 i = 0; i < signatures.length; i++) {
            address signer = ethSignedHash.recover(signatures[i]);
            
            if (signer <= lastSigner) revert InvalidSettlementProof(); // Enforce order
            if (trustedNitroliteSigners[signer]) validSignatures++;
            
            lastSigner = signer;
        }
        
        if (validSignatures < requiredSignatures) revert InsufficientSignatures();
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ADMIN FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    function setNitroliteSigner(address signer, bool trusted) external onlyOwner {
        trustedNitroliteSigners[signer] = trusted;
        emit NitroliteSignerUpdated(signer, trusted);
    }
    
    function setRequiredSignatures(uint256 count) external onlyOwner {
        requiredSignatures = count;
    }
    
    function setProtocolFee(uint256 feeBps) external onlyOwner {
        protocolFeeBps = feeBps;
    }
    
    function setProtocolTreasury(address treasury) external onlyOwner {
        if (treasury == address(0)) revert ZeroAddress();
        protocolTreasury = treasury;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // VIEW FUNCTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    
    function getAccountInfo(address user) external view returns (
        uint256 deposited,
        uint256 available,
        uint256 locked,
        bytes32 activeSessionId,
        SessionState state
    ) {
        UserAccount storage acc = accounts[user];
        return (
            acc.depositedAmount,
            acc.depositedAmount - acc.lockedAmount,
            acc.lockedAmount,
            acc.activeSessionId,
            acc.sessionState
        );
    }
}
