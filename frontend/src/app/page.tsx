"use client";

import { useState } from "react";
import { WalletButton } from "@/components/wallet-button";
import { useAccount } from "wagmi";
import {
  Upload,
  FileText,
  Loader2,
  ExternalLink,
  CheckCircle2,
} from "lucide-react";
import ReactMarkdown from "react-markdown";

export default function Home() {
  const { isConnected } = useAccount();
  const [markdown, setMarkdown] = useState("");
  const [tokenAddress, setTokenAddress] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<{
    transactionHash?: string;
    data?: any;
  } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isConnected) {
      alert("Please connect your wallet first");
      return;
    }

    if (!markdown.trim() || !tokenAddress.trim()) {
      alert("Please fill in all fields");
      return;
    }

    setIsLoading(true);
    setResponse(null);

    try {
      // Simulate workflow execution
      // Replace this with your actual workflow API call
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Mock response - replace with actual API response
      const mockResponse = {
        transactionHash:
          "0x" +
          Array.from({ length: 64 }, () =>
            Math.floor(Math.random() * 16).toString(16),
          ).join(""),
        data: {
          markdown: markdown,
          tokenAddress: tokenAddress,
          timestamp: new Date().toISOString(),
          status: "success",
        },
      };

      setResponse(mockResponse);
    } catch (error) {
      console.error("Error:", error);
      alert("An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const getEtherscanUrl = (hash: string) => {
    // Change to mainnet or other network as needed
    return `https://sepolia.etherscan.io/tx/${hash}`;
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-3">
              <FileText className="w-8 h-8 text-black" />
              <h1 className="text-2xl font-bold text-black">
                Covenant Sentinel
              </h1>
            </div>
            <WalletButton />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {!isConnected ? (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-6">
              <Upload className="w-8 h-8 text-gray-600" />
            </div>
            <h2 className="text-3xl font-bold text-black mb-4">
              Connect Your Wallet to Get Started
            </h2>
            <p className="text-gray-600 text-lg mb-8 max-w-2xl mx-auto">
              Upload markdown content and token address to the blockchain.
              Connect your wallet to begin the process.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Upload Form */}
            <div className="bg-white border border-gray-200 rounded-lg p-8 shadow-sm">
              <h2 className="text-2xl font-bold text-black mb-6">
                Upload Content
              </h2>

              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Token Address Input */}
                <div>
                  <label
                    htmlFor="tokenAddress"
                    className="block text-sm font-medium text-gray-900 mb-2"
                  >
                    Token Address
                  </label>
                  <input
                    type="text"
                    id="tokenAddress"
                    value={tokenAddress}
                    onChange={(e) => setTokenAddress(e.target.value)}
                    placeholder="0x..."
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all text-gray-900 placeholder-gray-400"
                    disabled={isLoading}
                  />
                </div>

                {/* Markdown Input */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label
                      htmlFor="markdown"
                      className="block text-sm font-medium text-gray-900"
                    >
                      Markdown Content
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowPreview(!showPreview)}
                      className="text-sm text-gray-600 hover:text-black transition-colors"
                    >
                      {showPreview ? "Hide Preview" : "Show Preview"}
                    </button>
                  </div>
                  <textarea
                    id="markdown"
                    value={markdown}
                    onChange={(e) => setMarkdown(e.target.value)}
                    placeholder="# Enter your markdown here&#10;&#10;This is a **bold** text example."
                    rows={12}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent outline-none transition-all font-mono text-sm text-gray-900 placeholder-gray-400 resize-none"
                    disabled={isLoading}
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={
                    isLoading || !markdown.trim() || !tokenAddress.trim()
                  }
                  className="w-full flex items-center justify-center space-x-2 px-6 py-4 bg-black text-white rounded-lg hover:bg-gray-800 transition-colors font-medium shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      <span>Start Workflow</span>
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Preview/Response Panel */}
            <div className="bg-white border border-gray-200 rounded-lg p-8 shadow-sm">
              {showPreview && markdown ? (
                <div>
                  <h2 className="text-2xl font-bold text-black mb-6">
                    Markdown Preview
                  </h2>
                  <div className="prose prose-sm max-w-none prose-headings:text-black prose-p:text-gray-900 prose-a:text-black prose-strong:text-black prose-code:text-black prose-pre:bg-gray-100 prose-pre:text-gray-900">
                    <ReactMarkdown>{markdown}</ReactMarkdown>
                  </div>
                </div>
              ) : response ? (
                <div>
                  <div className="flex items-center space-x-3 mb-6">
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                    <h2 className="text-2xl font-bold text-black">Success!</h2>
                  </div>

                  {/* Transaction Hash */}
                  {response.transactionHash && (
                    <div className="mb-6">
                      <h3 className="text-sm font-medium text-gray-900 mb-2">
                        Transaction Hash
                      </h3>
                      <a
                        href={getEtherscanUrl(response.transactionHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center space-x-2 p-4 bg-gray-50 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors group"
                      >
                        <code className="flex-1 text-sm text-gray-900 break-all font-mono">
                          {response.transactionHash}
                        </code>
                        <ExternalLink className="w-4 h-4 text-gray-600 group-hover:text-black flex-shrink-0" />
                      </a>
                    </div>
                  )}

                  {/* Response Data */}
                  {response.data && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-900 mb-2">
                        Response Data
                      </h3>
                      <pre className="p-4 bg-gray-50 border border-gray-200 rounded-lg overflow-x-auto text-sm text-gray-900">
                        {JSON.stringify(response.data, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-center h-full text-center py-20">
                  <div>
                    <div className="inline-flex items-center justify-center w-16 h-16 bg-gray-100 rounded-full mb-4">
                      <FileText className="w-8 h-8 text-gray-600" />
                    </div>
                    <p className="text-gray-600">
                      {markdown
                        ? 'Click "Show Preview" to see your markdown rendered'
                        : "Enter markdown content to see preview"}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-center text-gray-600 text-sm">
            Covenant Sentinel - Blockchain Content Management
          </p>
        </div>
      </footer>
    </div>
  );
}
