// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title SimpleDAOGovernor
 * @notice Simple example governance contract for TokenRelay DAO decisions
 * @dev This is a basic example. In production, use OpenZeppelin Governor or similar battle-tested solution.
 *
 * PRODUCTION NOTE: Use OpenZeppelin's Governor contract instead:
 * - Governor.sol (core voting logic)
 * - GovernorSettings.sol (voting parameters)
 * - GovernorCountingSimple.sol (vote counting)
 * - GovernorVotes.sol (ERC20Votes integration)
 * - GovernorTimelockControl.sol (timelock integration)
 */
contract SimpleDAOGovernor {
    // Governance token (used for voting power)
    IERC20 public governanceToken;

    // Voting parameters
    uint256 public votingPeriod; // In blocks
    uint256 public quorum; // Minimum votes needed (in token amount)
    uint256 public proposalThreshold; // Minimum tokens to create proposal

    // Proposal structure
    struct Proposal {
        uint256 id;
        address proposer;
        address target; // Contract to call (e.g., TokenRelay)
        bytes callData; // Function call data
        uint256 forVotes;
        uint256 againstVotes;
        uint256 startBlock;
        uint256 endBlock;
        bool executed;
        bool canceled;
        mapping(address => bool) hasVoted;
        string description;
    }

    // Proposal storage
    mapping(uint256 => Proposal) public proposals;
    uint256 public proposalCount;

    // Events
    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        address target,
        string description,
        uint256 startBlock,
        uint256 endBlock
    );
    event VoteCast(
        address indexed voter,
        uint256 indexed proposalId,
        bool support,
        uint256 weight
    );
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);

    // Errors
    error InsufficientTokensToPropose();
    error VotingNotActive();
    error AlreadyVoted();
    error ProposalNotSucceeded();
    error ProposalAlreadyExecuted();
    error ExecutionFailed();
    error QuorumNotReached();

    constructor(
        address _governanceToken,
        uint256 _votingPeriod,
        uint256 _quorum,
        uint256 _proposalThreshold
    ) {
        governanceToken = IERC20(_governanceToken);
        votingPeriod = _votingPeriod;
        quorum = _quorum;
        proposalThreshold = _proposalThreshold;
    }

    /**
     * @notice Create a proposal to change TokenRelay parameters
     * @param target The contract to call (TokenRelay address)
     * @param callData The encoded function call (e.g., setMaxFeePercentage(500))
     * @param description Human-readable description
     */
    function propose(
        address target,
        bytes memory callData,
        string memory description
    ) external returns (uint256) {
        // Check proposer has enough tokens
        if (governanceToken.balanceOf(msg.sender) < proposalThreshold) {
            revert InsufficientTokensToPropose();
        }

        proposalCount++;
        uint256 proposalId = proposalCount;

        Proposal storage newProposal = proposals[proposalId];
        newProposal.id = proposalId;
        newProposal.proposer = msg.sender;
        newProposal.target = target;
        newProposal.callData = callData;
        newProposal.startBlock = block.number;
        newProposal.endBlock = block.number + votingPeriod;
        newProposal.description = description;

        emit ProposalCreated(
            proposalId,
            msg.sender,
            target,
            description,
            newProposal.startBlock,
            newProposal.endBlock
        );

        return proposalId;
    }

    /**
     * @notice Vote on a proposal
     * @param proposalId The proposal ID
     * @param support True for yes, false for no
     */
    function castVote(uint256 proposalId, bool support) external {
        Proposal storage proposal = proposals[proposalId];

        // Check voting is active
        if (block.number < proposal.startBlock || block.number > proposal.endBlock) {
            revert VotingNotActive();
        }

        // Check hasn't voted
        if (proposal.hasVoted[msg.sender]) {
            revert AlreadyVoted();
        }

        // Get voting power (token balance at time of vote)
        uint256 weight = governanceToken.balanceOf(msg.sender);

        // Record vote
        proposal.hasVoted[msg.sender] = true;
        if (support) {
            proposal.forVotes += weight;
        } else {
            proposal.againstVotes += weight;
        }

        emit VoteCast(msg.sender, proposalId, support, weight);
    }

    /**
     * @notice Execute a successful proposal
     * @param proposalId The proposal ID
     */
    function execute(uint256 proposalId) external {
        Proposal storage proposal = proposals[proposalId];

        // Check voting has ended
        if (block.number <= proposal.endBlock) {
            revert VotingNotActive();
        }

        // Check not already executed
        if (proposal.executed) {
            revert ProposalAlreadyExecuted();
        }

        // Check quorum reached
        if (proposal.forVotes + proposal.againstVotes < quorum) {
            revert QuorumNotReached();
        }

        // Check proposal passed
        if (proposal.forVotes <= proposal.againstVotes) {
            revert ProposalNotSucceeded();
        }

        // Mark as executed
        proposal.executed = true;

        // Execute the proposal
        (bool success, ) = proposal.target.call(proposal.callData);
        if (!success) {
            revert ExecutionFailed();
        }

        emit ProposalExecuted(proposalId);
    }

    /**
     * @notice Get proposal details
     */
    function getProposal(uint256 proposalId)
        external
        view
        returns (
            address proposer,
            address target,
            bytes memory callData,
            uint256 forVotes,
            uint256 againstVotes,
            uint256 startBlock,
            uint256 endBlock,
            bool executed,
            bool canceled,
            string memory description
        )
    {
        Proposal storage proposal = proposals[proposalId];
        return (
            proposal.proposer,
            proposal.target,
            proposal.callData,
            proposal.forVotes,
            proposal.againstVotes,
            proposal.startBlock,
            proposal.endBlock,
            proposal.executed,
            proposal.canceled,
            proposal.description
        );
    }

    /**
     * @notice Check proposal state
     */
    function state(uint256 proposalId) external view returns (string memory) {
        Proposal storage proposal = proposals[proposalId];

        if (proposal.executed) return "Executed";
        if (proposal.canceled) return "Canceled";
        if (block.number < proposal.startBlock) return "Pending";
        if (block.number <= proposal.endBlock) return "Active";

        uint256 totalVotes = proposal.forVotes + proposal.againstVotes;
        if (totalVotes < quorum) return "Failed (Quorum not reached)";
        if (proposal.forVotes <= proposal.againstVotes) return "Defeated";

        return "Succeeded";
    }

    /**
     * @notice Check if address has voted on a proposal
     */
    function hasVoted(uint256 proposalId, address voter) external view returns (bool) {
        return proposals[proposalId].hasVoted[voter];
    }
}
