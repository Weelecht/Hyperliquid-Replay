import { useState, useMemo } from 'react'
import UserInput from './components/UserInput/UserInput'
import OrderManager from './components/OrderManager'
import Chart from './components/Chart'
import './App.css'

function App() {
  const [ethereumAddress, setEthereumAddress] = useState('')
  const [addressError, setAddressError] = useState('')
  const [selectedToken, setSelectedToken] = useState('')
  const [tokenTimeWindows, setTokenTimeWindows] = useState({})
  const [orders, setOrders] = useState([])
  const [trades, setTrades] = useState([])

  // Memoize filtered orders for better performance
  const filteredOrders = useMemo(() => {
    if (selectedToken === 'all') {
      return [];
    }
    const filtered = orders.filter(order => order.token === selectedToken);
    console.log('📊 Filtered orders for Chart:', {
      selectedToken,
      totalOrders: orders.length,
      filteredOrders: filtered.length,
      sampleOrders: filtered.slice(0, 3)
    });
    return filtered;
  }, [orders, selectedToken]);

  // Memoize filtered trades for better performance
  const filteredTrades = useMemo(() => {
    if (selectedToken === 'all') {
      return [];
    }
    const filtered = trades.filter(trade => trade.token === selectedToken);
    console.log('📈 Filtered trades for Chart:', {
      selectedToken,
      totalTrades: trades.length,
      filteredTrades: filtered.length,
      sampleTrades: filtered.slice(0, 3)
    });
    return filtered;
  }, [trades, selectedToken]);

  // Memoize current time window
  const currentTimeWindow = useMemo(() => {
    if (selectedToken && selectedToken !== 'all' && tokenTimeWindows[selectedToken]) {
      return tokenTimeWindows[selectedToken]
    }
    return null
  }, [selectedToken, tokenTimeWindows]);

  const handleAddressChange = (e) => {
    const value = e.target.value
    const previousAddress = ethereumAddress
    
    setEthereumAddress(value)
    
    // Clear error when user starts typing
    if (addressError) {
      setAddressError('')
    }
    
    // If we had a previous address and the new address is different, reset all state
    if (previousAddress && previousAddress !== value) {
      console.log('Address changed, resetting state for new address:', value)
      
      // Reset all state related to the previous address
      setSelectedToken('')
      setTokenTimeWindows({})
      setOrders([])
      setTrades([])
    }
  }

  const validateEthereumAddress = (address) => {
    // Basic Ethereum address validation (0x followed by 40 hex characters)
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/
    return ethAddressRegex.test(address)
  }

  const handleAddressBlur = () => {
    if (ethereumAddress && !validateEthereumAddress(ethereumAddress)) {
      setAddressError('Please enter a valid Ethereum address')
    }
  }

  const handleTokenSelect = (token) => {
    setSelectedToken(token)
  }

  const handleTimeWindowUpdate = (timeWindows) => {
    setTokenTimeWindows(timeWindows)
  }

  const handleOrdersUpdate = (newOrders) => {
    setOrders(newOrders)
  }

  const handleTradesUpdate = (newTrades) => {
    setTrades(newTrades)
  }

  return (
    <div className="App">
      <h1>Hyperliquid Replay</h1>
      <p>Enter your Ethereum address to get started</p>
      
      <div className="form-container">
        <UserInput
          label="Ethereum Address"
          type="text"
          placeholder="0x..."
          value={ethereumAddress}
          onChange={handleAddressChange}
          onBlur={handleAddressBlur}
          name="ethereumAddress"
          required
          error={addressError}
        />
      </div>

      <Chart selectedToken={selectedToken} timeWindow={currentTimeWindow} orders={filteredOrders} trades={filteredTrades} />
      
      <OrderManager 
        ethereumAddress={ethereumAddress} 
        selectedToken={selectedToken}
        onTokenSelect={handleTokenSelect}
        onTimeWindowUpdate={handleTimeWindowUpdate}
        onOrdersUpdate={handleOrdersUpdate}
        onTradesUpdate={handleTradesUpdate}
      />
    </div>
  )
}

export default App
