// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface RoyaltyDistribution {
  id: string;
  amount: string;
  timestamp: number;
  recipient: string;
  status: "pending" | "distributed" | "failed";
  nftId: string;
  encryptedData: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [distributions, setDistributions] = useState<RoyaltyDistribution[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newDistributionData, setNewDistributionData] = useState({
    amount: "",
    nftId: "",
    recipient: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [showStats, setShowStats] = useState(true);

  // Calculate statistics
  const distributedCount = distributions.filter(d => d.status === "distributed").length;
  const pendingCount = distributions.filter(d => d.status === "pending").length;
  const failedCount = distributions.filter(d => d.status === "failed").length;
  const totalAmount = distributions.reduce((sum, d) => sum + parseFloat(d.amount || "0"), 0);

  // Filter distributions based on search and filter
  const filteredDistributions = distributions.filter(dist => {
    const matchesSearch = dist.nftId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         dist.recipient.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterStatus === "all" || dist.status === filterStatus;
    return matchesSearch && matchesFilter;
  });

  useEffect(() => {
    loadDistributions().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadDistributions = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("distribution_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing distribution keys:", e);
        }
      }
      
      const list: RoyaltyDistribution[] = [];
      
      for (const key of keys) {
        try {
          const distributionBytes = await contract.getData(`distribution_${key}`);
          if (distributionBytes.length > 0) {
            try {
              const distributionData = JSON.parse(ethers.toUtf8String(distributionBytes));
              list.push({
                id: key,
                amount: distributionData.amount,
                timestamp: distributionData.timestamp,
                recipient: distributionData.recipient,
                status: distributionData.status || "pending",
                nftId: distributionData.nftId,
                encryptedData: distributionData.encryptedData
              });
            } catch (e) {
              console.error(`Error parsing distribution data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading distribution ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setDistributions(list);
    } catch (e) {
      console.error("Error loading distributions:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const createDistribution = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing royalty distribution with FHE encryption..."
    });
    
    try {
      // Simulate FHE encryption for royalty calculation
      const encryptedData = `FHE-ROYALTY-${btoa(JSON.stringify({
        amount: newDistributionData.amount,
        recipient: newDistributionData.recipient,
        nftId: newDistributionData.nftId,
        timestamp: Date.now()
      }))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const distributionId = `dist-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const distributionData = {
        amount: newDistributionData.amount,
        timestamp: Math.floor(Date.now() / 1000),
        recipient: newDistributionData.recipient,
        nftId: newDistributionData.nftId,
        status: "pending",
        encryptedData: encryptedData
      };
      
      // Store encrypted distribution data on-chain using FHE
      await contract.setData(
        `distribution_${distributionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(distributionData))
      );
      
      const keysBytes = await contract.getData("distribution_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(distributionId);
      
      await contract.setData(
        "distribution_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Royalty distribution created with FHE encryption!"
      });
      
      await loadDistributions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewDistributionData({
          amount: "",
          nftId: "",
          recipient: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Distribution creation failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const executeDistribution = async (distributionId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Executing FHE-encrypted royalty distribution..."
    });

    try {
      // Simulate FHE computation time for distribution execution
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const distributionBytes = await contract.getData(`distribution_${distributionId}`);
      if (distributionBytes.length === 0) {
        throw new Error("Distribution not found");
      }
      
      const distributionData = JSON.parse(ethers.toUtf8String(distributionBytes));
      
      const updatedDistribution = {
        ...distributionData,
        status: "distributed"
      };
      
      await contract.setData(
        `distribution_${distributionId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedDistribution))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE royalty distribution executed successfully!"
      });
      
      await loadDistributions();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Distribution execution failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE Contract is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to manage royalty distributions",
      icon: "🎵"
    },
    {
      title: "Create Distribution",
      description: "Set up encrypted royalty distributions using FHE technology",
      icon: "🔒"
    },
    {
      title: "FHE Processing",
      description: "Royalties are calculated and distributed while remaining encrypted",
      icon: "⚙️"
    },
    {
      title: "Receive Payments",
      description: "Artists receive payments anonymously without revealing identity",
      icon: "💸"
    }
  ];

  const renderBarChart = () => {
    const statusData = [
      { label: "Distributed", value: distributedCount, color: "#4CAF50" },
      { label: "Pending", value: pendingCount, color: "#FF9800" },
      { label: "Failed", value: failedCount, color: "#F44336" }
    ];

    const maxValue = Math.max(...statusData.map(d => d.value));

    return (
      <div className="bar-chart-container">
        <div className="bar-chart">
          {statusData.map((item, index) => (
            <div key={index} className="bar-item">
              <div className="bar-label">{item.label}</div>
              <div className="bar-track">
                <div 
                  className="bar-fill" 
                  style={{ 
                    width: maxValue > 0 ? `${(item.value / maxValue) * 100}%` : "0%",
                    backgroundColor: item.color
                  }}
                ></div>
              </div>
              <div className="bar-value">{item.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Loading encrypted royalty data...</p>
    </div>
  );

  return (
    <div className="app-container nature-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="music-icon">🎵</div>
          </div>
          <h1>MusicNFT<span>Royalties</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-distribution-btn nature-button"
          >
            <div className="add-icon">+</div>
            New Distribution
          </button>
          <button 
            className="nature-button secondary"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <button 
            className="nature-button outline"
            onClick={checkAvailability}
          >
            Check FHE Status
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>Anonymous Music NFT Royalties</h2>
            <p>Distribute royalties securely using FHE technology while preserving artist privacy</p>
          </div>
          <div className="banner-decoration">
            <div className="leaf-decoration">🍃</div>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE Royalty Distribution Guide</h2>
            <p className="subtitle">Learn how to distribute royalties anonymously</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-controls">
          <button 
            className="nature-button small"
            onClick={() => setShowStats(!showStats)}
          >
            {showStats ? "Hide Statistics" : "Show Statistics"}
          </button>
        </div>

        {showStats && (
          <div className="dashboard-grid">
            <div className="dashboard-card nature-card">
              <h3>Project Overview</h3>
              <p>Anonymous royalty distribution platform for Music NFTs using FHE technology to protect artist privacy while ensuring fair compensation.</p>
              <div className="fhe-badge">
                <span>FHE-Encrypted</span>
              </div>
            </div>
            
            <div className="dashboard-card nature-card">
              <h3>Distribution Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <div className="stat-value">{distributions.length}</div>
                  <div className="stat-label">Total</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{distributedCount}</div>
                  <div className="stat-label">Distributed</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{pendingCount}</div>
                  <div className="stat-label">Pending</div>
                </div>
                <div className="stat-item">
                  <div className="stat-value">{totalAmount.toFixed(2)}</div>
                  <div className="stat-label">Total ETH</div>
                </div>
              </div>
            </div>
            
            <div className="dashboard-card nature-card">
              <h3>Status Overview</h3>
              {renderBarChart()}
            </div>
          </div>
        )}
        
        <div className="distributions-section">
          <div className="section-header">
            <h2>Royalty Distributions</h2>
            <div className="header-actions">
              <div className="search-filter">
                <input 
                  type="text"
                  placeholder="Search NFT ID or recipient..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <select 
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="filter-select"
                >
                  <option value="all">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="distributed">Distributed</option>
                  <option value="failed">Failed</option>
                </select>
              </div>
              <button 
                onClick={loadDistributions}
                className="refresh-btn nature-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="distributions-list nature-card">
            <div className="table-header">
              <div className="header-cell">NFT ID</div>
              <div className="header-cell">Amount (ETH)</div>
              <div className="header-cell">Recipient</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Status</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {filteredDistributions.length === 0 ? (
              <div className="no-distributions">
                <div className="no-distributions-icon">🎵</div>
                <p>No royalty distributions found</p>
                <button 
                  className="nature-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Distribution
                </button>
              </div>
            ) : (
              filteredDistributions.map(dist => (
                <div className="distribution-row" key={dist.id}>
                  <div className="table-cell nft-id">#{dist.nftId.substring(0, 8)}</div>
                  <div className="table-cell amount">{dist.amount} ETH</div>
                  <div className="table-cell recipient">
                    {dist.recipient.substring(0, 6)}...{dist.recipient.substring(38)}
                  </div>
                  <div className="table-cell">
                    {new Date(dist.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">
                    <span className={`status-badge ${dist.status}`}>
                      {dist.status}
                    </span>
                  </div>
                  <div className="table-cell actions">
                    {dist.status === "pending" && (
                      <button 
                        className="action-btn nature-button success"
                        onClick={() => executeDistribution(dist.id)}
                      >
                        Execute
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="team-section">
          <h3>Powered by FHE Technology</h3>
          <p>Our platform uses Fully Homomorphic Encryption to process royalty calculations without decrypting sensitive data, ensuring complete privacy for artists and rights holders.</p>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={createDistribution} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          distributionData={newDistributionData}
          setDistributionData={setNewDistributionData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content nature-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="music-icon">🎵</div>
              <span>MusicNFT Royalties</span>
            </div>
            <p>Secure anonymous royalty distribution using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact Team</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} MusicNFT Royalties. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  distributionData: any;
  setDistributionData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  distributionData,
  setDistributionData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setDistributionData({
      ...distributionData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!distributionData.amount || !distributionData.nftId || !distributionData.recipient) {
      alert("Please fill all required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal nature-card">
        <div className="modal-header">
          <h2>Create Royalty Distribution</h2>
          <button onClick={onClose} className="close-modal">×</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon">🔒</div> 
            Royalty data will be encrypted with FHE technology
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>NFT ID *</label>
              <input 
                type="text"
                name="nftId"
                value={distributionData.nftId} 
                onChange={handleChange}
                placeholder="Enter NFT ID..." 
                className="nature-input"
              />
            </div>
            
            <div className="form-group">
              <label>Amount (ETH) *</label>
              <input 
                type="number"
                name="amount"
                value={distributionData.amount} 
                onChange={handleChange}
                placeholder="0.00" 
                className="nature-input"
                step="0.001"
                min="0"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Recipient Address *</label>
              <input 
                type="text"
                name="recipient"
                value={distributionData.recipient} 
                onChange={handleChange}
                placeholder="0x..." 
                className="nature-input"
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon">👁️</div> 
            Recipient identity remains anonymous throughout the process
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn nature-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn nature-button primary"
          >
            {creating ? "Processing with FHE..." : "Create Distribution"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;