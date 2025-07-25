import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { createChart, CandlestickSeries, LineSeries, ColorType, createSeriesMarkers } from 'lightweight-charts';
import './Chart.css';

const Chart = ({ selectedToken, timeWindow, orders = [], trades = [], width = '100%', height = '400px' }) => {
  const chartContainerRef = useRef();
  const chartRef = useRef();
  const seriesRef = useRef();
  const markersRef = useRef();
  const tradeMarkersRef = useRef();
  const abortControllerRef = useRef();
  const [selectedTimeframe, setSelectedTimeframe] = useState('5m');
  const [currentPrice, setCurrentPrice] = useState('');
  const [orderMarkers, setOrderMarkers] = useState([]);
  const [seriesReady, setSeriesReady] = useState(false);
  const [dataLoaded, setDataLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(null);
  const [chartHeight, setChartHeight] = useState(600);

  // Cluster orders to reduce visual clutter and improve performance
  const clusterOrders = (orders) => {
    const clusters = new Map();
    const clusterThreshold = 0.001; // 0.1% price difference for clustering
    const timeThreshold = 300; // 5 minutes in seconds

    // Separate TWAP orders from regular orders
    const twapOrders = orders.filter(order => order.isTwap);
    const regularOrders = orders.filter(order => !order.isTwap);

    console.log('🔍 Clustering orders:', {
      totalOrders: orders.length,
      twapOrders: twapOrders.length,
      regularOrders: regularOrders.length
    });

    // Only cluster regular orders (exclude TWAP orders)
    regularOrders.forEach(order => {
      const price = parseFloat(order.price);
      const orderTime = new Date(order.timestamp).getTime() / 1000;
      
      // Create cluster key based on price and time proximity
      const priceKey = Math.round(price / (price * clusterThreshold));
      const timeKey = Math.floor(orderTime / timeThreshold);
      const clusterKey = `${priceKey}-${timeKey}-${order.side}-${order.type}`;
      
      if (!clusters.has(clusterKey)) {
        clusters.set(clusterKey, {
          orders: [],
          avgPrice: 0,
          avgTime: 0,
          side: order.side,
          type: order.type,
          count: 0
        });
      }
      
      const cluster = clusters.get(clusterKey);
      cluster.orders.push(order);
      cluster.count++;
    });

    // Convert clusters to representative orders
    const clusteredOrders = Array.from(clusters.values()).map(cluster => {
      const totalPrice = cluster.orders.reduce((sum, order) => sum + parseFloat(order.price), 0);
      const totalTime = cluster.orders.reduce((sum, order) => sum + new Date(order.timestamp).getTime() / 1000, 0);
      
      return {
        ...cluster.orders[0], // Use first order as template
        price: (totalPrice / cluster.count).toFixed(6),
        timestamp: new Date((totalTime / cluster.count) * 1000).toISOString(),
        clusterSize: cluster.count,
        isCluster: cluster.count > 1
      };
    });

    // Combine clustered regular orders with unclustered TWAP orders
    const result = [...clusteredOrders, ...twapOrders];
    
    console.log('✅ Clustering completed:', {
      originalOrders: orders.length,
      clusteredOrders: clusteredOrders.length,
      twapOrders: twapOrders.length,
      finalResult: result.length,
      twapOrdersInResult: result.filter(o => o.isTwap).length
    });

    return result;
  };

  // Performance optimization: Memoize filtered and processed orders
  const processedOrders = useMemo(() => {
    if (!orders.length) return [];
    
    // Filter out invalid orders, but preserve TWAP orders even if they have invalid prices
    const validOrders = orders.filter(order => {
      const price = parseFloat(order.price);
      // Always include TWAP orders, even with invalid prices (they'll be handled later)
      if (order.isTwap) return true;
      return !isNaN(price) && price > 0;
    });

    console.log('🔍 Processing orders:', {
      originalOrders: orders.length,
      validOrders: validOrders.length,
      twapOrders: validOrders.filter(o => o.isTwap).length,
      regularOrders: validOrders.filter(o => !o.isTwap).length
    });

    // If we have too many orders, implement clustering (TWAP orders are excluded from clustering)
    if (validOrders.length > 500) {
      console.log('📊 Applying clustering (TWAP orders excluded)');
      return clusterOrders(validOrders);
    }

    console.log('📊 No clustering applied, using all orders');
    return validOrders;
  }, [orders]);

  // Calculate order statistics for display
  const orderStats = useMemo(() => {
    const openOrders = processedOrders.filter(order => order.type === 'open');
    const openBuyOrders = openOrders.filter(order => order.side === 'buy');
    const openSellOrders = openOrders.filter(order => order.side === 'sell');
    const twapOrders = processedOrders.filter(order => order.isTwap);
    
    return {
      totalOpen: openOrders.length,
      openBuy: openBuyOrders.length,
      openSell: openSellOrders.length,
      twap: twapOrders.length,
      total: processedOrders.length
    };
  }, [processedOrders]);

  // Available timeframes
  const timeframes = [
    { value: '1m', label: '1m' },
    { value: '5m', label: '5m' },
    { value: '15m', label: '15m' },
    { value: '30m', label: '30m' },
    { value: '1h', label: '1h' },
    { value: '4h', label: '4h' },
    { value: '1d', label: '1d' }
  ];

  // Clear price lines and reset chart state
  const clearPriceLines = () => {
    if (chartRef.current && chartRef.current.priceLines) {
      chartRef.current.priceLines.forEach(priceLine => {
        try {
        chartRef.current.removeSeries(priceLine);
        } catch (error) {
          console.warn('Error removing price line:', error);
        }
      });
      chartRef.current.priceLines = [];
    }
  };

  // Complete chart reset function
  const resetChart = useCallback(() => {
    if (!chartRef.current) return;
    
    console.log('🔄 Performing complete chart reset');
    
    // Clear price lines (this removes additional series)
    clearPriceLines();
    
    // Clear markers
    if (markersRef.current) {
      try {
        markersRef.current.setMarkers([]);
        } catch (error) {
        console.warn('Error clearing order markers:', error);
      }
      markersRef.current = null;
    }
    
    if (tradeMarkersRef.current) {
      try {
        tradeMarkersRef.current.setMarkers([]);
      } catch (error) {
        console.warn('Error clearing trade markers:', error);
      }
      tradeMarkersRef.current = null;
    }

    // Clear ladder markers
    if (chartRef.current && chartRef.current.ladderMarkers) {
      chartRef.current.ladderMarkers.forEach(ladderMarker => {
        try {
          ladderMarker.setMarkers([]);
        } catch (error) {
          console.warn('Error clearing ladder markers:', error);
        }
      });
      chartRef.current.ladderMarkers = [];
    }
    
    // Clear main series data
    if (seriesRef.current) {
      seriesRef.current.setData([]);
    }
    
    // Reset chart scales
    try {
      // Reset time scale
      chartRef.current.timeScale().resetTimeScale();
      
      // Reset price scale
      chartRef.current.priceScale('right').applyOptions({
        autoScale: true,
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      });
      
      // Fit content to reset view
      chartRef.current.timeScale().fitContent();
    } catch (error) {
      console.warn('Error resetting chart scales:', error);
    }
    
    // Reset state
    setDataLoaded(false);
    setCurrentPrice('');
    setOrderMarkers([]);
    
    console.log('✅ Chart reset completed');
  }, []);

  // Create persistent TWAP markers that never disappear (no viewport filtering)
  const createPersistentTwapMarkers = useCallback(() => {
    console.log('🎯 createPersistentTwapMarkers called with:', {
      hasChart: !!chartRef.current,
      hasSeries: !!seriesRef.current,
      processedOrdersLength: processedOrders.length,
      twapOrdersCount: processedOrders.filter(o => o.isTwap).length,
      sellTwapCount: processedOrders.filter(o => o.isTwap && o.side === 'sell').length,
      buyTwapCount: processedOrders.filter(o => o.isTwap && o.side === 'buy').length
    });

    if (!chartRef.current || !seriesRef.current) {
      console.log('❌ Chart or series not ready, skipping persistent TWAP markers');
      return;
    }

    // Get ALL TWAP orders - NO viewport filtering at all
    const allTwapOrders = processedOrders.filter(order => {
      if (!order.isTwap) return false;
      
      console.log('🔍 Including persistent TWAP order (no viewport filtering):', {
        token: order.token,
        side: order.side,
        direction: order.direction,
        timestamp: order.timestamp
      });
      
      return true;
    });

    console.log('🎯 Creating persistent TWAP markers (no viewport filtering):', {
      totalTwapOrders: processedOrders.filter(o => o.isTwap).length,
      allTwapOrders: allTwapOrders.length,
      twapOrdersBySide: allTwapOrders.reduce((acc, order) => {
        acc[order.side] = (acc[order.side] || 0) + 1;
        return acc;
      }, {}),
      hypeTwapOrders: allTwapOrders.filter(o => o.token === 'HYPE'),
      sellTwapOrders: allTwapOrders.filter(o => o.side === 'sell'),
      buyTwapOrders: allTwapOrders.filter(o => o.side === 'buy')
    });

    // Create markers for ALL TWAP orders
    const markers = allTwapOrders.map(order => {
      const orderTime = new Date(order.timestamp).getTime() / 1000;
      const price = parseFloat(order.price);
      
      if (isNaN(price) || price <= 0) {
        console.warn('⚠️ Skipping persistent TWAP order with invalid price:', {
          token: order.token,
          side: order.side,
          price: order.price,
          parsedPrice: price
        });
        return null;
      }

      // TWAP orders - use dots with side-based colors
      const color = order.side === 'buy' ? '#10b981' : '#ef4444'; // Green for buy, red for sell
      const shape = 'circle'; // Use circle/dot shape for TWAP
      const position = 'inBar'; // Position in the bar for better visibility
      const size = 1; // Small dots for all TWAP orders
      
      const marker = {
        time: orderTime,
        position: position,
        color: color,
        shape: shape,
        size: size
      };
      
      console.log('🎯 Creating persistent TWAP marker:', {
        token: order.token,
        side: order.side,
        direction: order.direction,
        price: price,
        time: orderTime,
        color: color
      });
      
      return marker;
    }).filter(Boolean);

    console.log('🎯 Final persistent TWAP markers array:', {
      totalMarkers: markers.length,
      markersByColor: markers.reduce((acc, marker) => {
        acc[marker.color] = (acc[marker.color] || 0) + 1;
        return acc;
      }, {}),
      redMarkers: markers.filter(m => m.color === '#ef4444').length,
      greenMarkers: markers.filter(m => m.color === '#10b981').length
    });

    // Remove existing markers if any
    if (markersRef.current) {
      try {
        markersRef.current.setMarkers([]);
        console.log('🧹 Cleared existing TWAP markers');
      } catch (error) {
        console.warn('⚠️ Error clearing existing TWAP markers:', error);
      }
    }
    
    // Create new persistent TWAP markers
    if (markers.length > 0) {
      try {
        markersRef.current = createSeriesMarkers(seriesRef.current, markers);
        console.log(`✅ Created ${markers.length} persistent TWAP markers (no viewport filtering)`);
        console.log(`✅ Red markers (sell-side): ${markers.filter(m => m.color === '#ef4444').length}`);
        console.log(`✅ Green markers (buy-side): ${markers.filter(m => m.color === '#10b981').length}`);
        
        // Verify markers were actually set
        if (markersRef.current) {
          console.log('✅ Persistent TWAP markers successfully created and attached to series');
        } else {
          console.error('❌ Persistent TWAP markers reference is null after creation');
        }
      } catch (error) {
        console.error('❌ Error creating persistent TWAP markers:', error);
        console.error('❌ Error details:', {
          error: error.message,
          stack: error.stack,
          markersLength: markers.length,
          seriesRef: !!seriesRef.current
        });
      }
    } else {
      console.log('⚠️ No persistent TWAP markers to create');
    }
    
    // Store TWAP order data for display in the UI
    const orderData = allTwapOrders.map(order => {
      const timestamp = new Date(order.timestamp).getTime() / 1000;
      const price = parseFloat(order.price);
      
      if (isNaN(price) || price <= 0) return null;

      return {
        time: timestamp,
        price: price,
        side: order.side,
        type: order.type,
        size: order.isCluster ? `${order.clusterSize} orders` : '1 order',
        count: order.clusterSize || 1,
        color: order.side === 'buy' ? '#10b981' : '#ef4444',
        timestamp: order.timestamp,
        details: order.isCluster ? { clusterSize: order.clusterSize } : {},
        isCluster: order.isCluster,
        isTwap: order.isTwap
      };
    }).filter(Boolean);

    setOrderMarkers(orderData);
    console.log('Persistent TWAP markers created:', orderData.length);
  }, [processedOrders]);

  // Create TWAP markers only (no arrow markers) - DEPRECATED, use createPersistentTwapMarkers instead
  const createTwapMarkers = useCallback(() => {
    console.log('⚠️ DEPRECATED: createTwapMarkers called, redirecting to createPersistentTwapMarkers');
    createPersistentTwapMarkers();
  }, [createPersistentTwapMarkers]);

  // Optimized order marker creation with batching
  const createOrderMarkers = useCallback(() => {
    if (!chartRef.current || !processedOrders.length) return;

    console.log('🎯 Creating order markers for', processedOrders.length, 'orders (processed from', orders.length, 'original)');

    // Clear existing price lines
    clearPriceLines();

    // Get visible range for line width calculation
    const visibleRange = chartRef.current.timeScale().getVisibleRange();
    if (!visibleRange) return;

    // Batch process orders for better performance
    const batchSize = 50;
    const batches = [];
    
    for (let i = 0; i < processedOrders.length; i += batchSize) {
      batches.push(processedOrders.slice(i, i + batchSize));
    }

    // Process batches with requestAnimationFrame for better UX
    const processBatch = (batchIndex) => {
      if (batchIndex >= batches.length) {
        // All batches processed, create TWAP markers only
        createPersistentTwapMarkers();
        return;
      }

      const batch = batches[batchIndex];
      
      // Process this batch
      batch.forEach((order) => {
      const price = parseFloat(order.price);
      const orderTime = new Date(order.timestamp).getTime() / 1000;
      
      if (isNaN(price) || price <= 0) return;

        // Skip TWAP orders for price lines - they get dot markers instead
        if (order.isTwap) return;

      // Determine color based on order type and side
      let color, lineStyle;
      color = order.type === 'open' 
        ? (order.side === 'buy' ? '#f97316' : '#a855f7')
        : order.type === 'cancelled'
        ? (order.side === 'buy' ? '#f97316' : '#a855f7')
        : (order.side === 'buy' ? '#10b981' : '#ef4444');
      lineStyle = order.type === 'open' ? 0 : 1;
      
      try {
        // Create a horizontal line series for this order price
        const priceLineSeries = chartRef.current.addSeries(LineSeries, {
          color: color,
            lineWidth: order.isCluster ? 3 : 2, // Thicker lines for clusters
          lineStyle: lineStyle,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        
        // Calculate the width based on default
        const timeSpan = visibleRange.to - visibleRange.from;
        const estimatedCandleCount = Math.ceil(timeSpan / (60 * 60));
        const averageCandleWidth = timeSpan / Math.max(estimatedCandleCount, 1);
          const lineWidth = averageCandleWidth * (order.isCluster ? 2 : 1.5);
        const halfWidth = lineWidth / 2;
        const lineStart = orderTime - halfWidth;
        const lineEnd = orderTime + halfWidth;
        
        const lineData = [
          { time: lineStart, value: price },
          { time: lineEnd, value: price }
        ];
        
        priceLineSeries.setData(lineData);
        
          // Ensure priceLines array exists before pushing
          if (!chartRef.current.priceLines) {
            chartRef.current.priceLines = [];
          }
          chartRef.current.priceLines.push(priceLineSeries);
      } catch (lineError) {
        console.error('Error adding price line for order:', order, lineError);
      }
    });
    
      // Schedule next batch
      requestAnimationFrame(() => processBatch(batchIndex + 1));
    };

    // Start processing batches
    processBatch(0);
  }, [processedOrders, orders.length, createPersistentTwapMarkers]);

  // Handle manual chart resizing
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (e.target.classList.contains('chart-resize-handle')) {
        e.preventDefault();
        
        const startY = e.clientY;
        const startHeight = chartHeight;
        
                 const handleMouseMove = (e) => {
           const deltaY = e.clientY - startY;
           const newHeight = Math.max(600, Math.min(1200, startHeight + deltaY));
           setChartHeight(newHeight);
         };
        
        const handleMouseUp = () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mouseup', handleMouseUp);
        };
        
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
      }
    };
    
    document.addEventListener('mousedown', handleMouseDown);
    
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [chartHeight]);

  // Fetch pricing data from HyperLiquid
  const fetchPricingData = async (token, window, timeframe) => {
    console.log('🔍 fetchPricingData called with:', { token, window, timeframe });
    
    if (!token || token === 'all') {
      console.log('❌ Invalid token, returning empty array');
      return [];
    }

    try {
      let start, end;
      
      if (window && window.earliest && window.latest) {
        // Use the time window from order timestamps
        start = new Date(window.earliest);
        end = new Date(window.latest);
        console.log(`📅 Using order-based time window for ${token}:`, {
          start: start.toISOString(),
          end: end.toISOString(),
          startMs: +start,
          endMs: +end
        });
      } else {
        // Fallback to 24-hour window if no time window provided
        end = new Date();
        start = new Date(end.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago
        console.log(`📅 No time window provided, using 24-hour fallback for ${token}:`, {
          start: start.toISOString(),
          end: end.toISOString(),
          startMs: +start,
          endMs: +end
        });
      }

      // Try different timeframes if the requested one fails
      const timeframesToTry = [timeframe, '1h', '4h', '1d'];
      let lastError = null;

      for (const currentTimeframe of timeframesToTry) {
        try {
          console.log(`🔄 Trying timeframe: ${currentTimeframe}`);
          
          // Create request payload
          const requestPayload = {
            type: 'candleSnapshot',
            req: {
              coin: token.toUpperCase(),
              interval: currentTimeframe,
              startTime: +start,
              endTime: +end
            }
          };
          
          console.log('📤 Sending request to HyperLiquid API:', {
            url: 'https://api.hyperliquid.xyz/info',
            method: 'POST',
            payload: requestPayload
          });

          // Create a timeout promise
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Request timeout')), 10000); // 10 second timeout
          });

          // Fetch candlestick data from HyperLiquid using selected timeframe
          const fetchPromise = fetch('https://api.hyperliquid.xyz/info', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestPayload),
            signal: abortControllerRef.current?.signal
          });

          // Race between fetch and timeout
          const response = await Promise.race([fetchPromise, timeoutPromise]);
          
          console.log('📥 Received response:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            headers: Object.fromEntries(response.headers.entries())
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API Error Response:', {
              status: response.status,
              statusText: response.statusText,
              body: errorText
            });
            throw new Error(`HTTP error! status: ${response.status} - ${errorText}`);
          }

          const data = await response.json();
          console.log('📊 Raw API response data:', {
            type: typeof data,
            isArray: Array.isArray(data),
            length: Array.isArray(data) ? data.length : 'N/A',
            data: data
          });
          
          // Check if data is valid
          if (!Array.isArray(data)) {
            console.error('❌ Invalid data format - expected array but got:', {
              type: typeof data,
              value: data
            });
            throw new Error('Invalid data format received from API');
          }
          
          if (data.length === 0) {
            console.warn(`⚠️ API returned empty array for token: ${token} with timeframe: ${currentTimeframe}`);
            lastError = new Error(`No data available for ${currentTimeframe} timeframe`);
            continue; // Try next timeframe
          }
          
          // Transform the data to match lightweight-charts format
          const transformedData = data.map((candle, index) => {
            const transformed = {
              time: candle.t / 1000, // Convert to seconds
              open: parseFloat(candle.o),
              high: parseFloat(candle.h),
              low: parseFloat(candle.l),
              close: parseFloat(candle.c)
            };
            
            // Log first few candles for debugging
            if (index < 3) {
              console.log(`🕯️ Candle ${index}:`, {
                original: candle,
                transformed: transformed
              });
            }
            
            return transformed;
          });

          console.log(`✅ Successfully fetched data with timeframe ${currentTimeframe}:`, {
            originalLength: data.length,
            transformedLength: transformedData.length,
            firstCandle: transformedData[0],
            lastCandle: transformedData[transformedData.length - 1]
          });
          
          return transformedData;
        } catch (err) {
          lastError = err;
          console.warn(`⚠️ Failed to fetch data with timeframe ${currentTimeframe}:`, err.message);
          continue; // Try next timeframe
        }
      }

      // If we get here, all timeframes failed
      console.error('❌ All timeframes failed:', lastError);
      throw lastError || new Error('Failed to fetch data with any timeframe');
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log('🛑 Request was aborted');
        throw new Error('Request cancelled');
      }
      console.error('❌ Error fetching pricing data:', {
        error: err,
        message: err.message,
        stack: err.stack
      });
      throw err; // Re-throw to let the calling function handle it
    }
  };

  // Initialize chart
  useEffect(() => {
    if (chartContainerRef.current) {
      try {
        // Get container dimensions
        const container = chartContainerRef.current;
        const containerWidth = container.clientWidth;
        const containerHeight = chartHeight;
        
        console.log('📏 Chart container dimensions:', {
          width: containerWidth,
          height: containerHeight,
          containerStyle: window.getComputedStyle(container)
        });

        // Calculate available height for chart (subtract header height)
        const headerHeight = container.querySelector('.chart-header')?.offsetHeight || 0;
        const chartAreaHeight = containerHeight - headerHeight;
        
        // Ensure minimum chart area height for time scale visibility
        const minChartAreaHeight = 350; // Minimum height needed for time scale at 600px default
        const finalChartHeight = Math.max(chartAreaHeight, minChartAreaHeight);
        
        console.log('📊 Chart area calculation:', {
          totalHeight: containerHeight,
          headerHeight: headerHeight,
          chartAreaHeight: chartAreaHeight,
          finalChartHeight: finalChartHeight,
          hasEnoughSpace: finalChartHeight >= minChartAreaHeight
        });
        
        // Create the chart with proper dimensions
        const chart = createChart(container, {
          width: containerWidth,
          height: finalChartHeight,
          layout: {
            background: { type: ColorType.Solid, color: '#1a1a1a' },
            textColor: '#e5e7eb',
          },
          grid: {
            vertLines: { color: '#2d2d2d' },
            horzLines: { color: '#2d2d2d' },
          },
          crosshair: {
            mode: 0, // Disable crosshair
          },
          rightPriceScale: {
            borderColor: '#2d2d2d',
            textColor: '#e5e7eb',
            backgroundColor: '#1a1a1a',
          },
          timeScale: {
            borderColor: '#2d2d2d',
            textColor: '#e5e7eb',
            backgroundColor: '#1a1a1a',
            timeVisible: true,
            secondsVisible: false,
            visible: true,
            rightOffset: 12,
            leftOffset: 12,
            barSpacing: 3,
            minBarSpacing: 1,
            fixLeftEdge: false,
            fixRightEdge: false,
            lockVisibleTimeRangeOnResize: false,
            rightBarStaysOnScroll: false,
            borderVisible: true,
            visibleLogicalRange: null,
            ticksVisible: true,
            // Ensure time scale is always visible with proper spacing
            scaleMargins: {
              top: 0.08,
              bottom: 0.15, // Adjusted bottom margin for 600px default height
            },
          },
        });

        // Add candlestick series
        const candlestickSeries = chart.addSeries(CandlestickSeries, {
          upColor: '#26a69a',
          downColor: '#ef5350',
          borderVisible: false,
          wickUpColor: '#26a69a',
          wickDownColor: '#ef5350',
        });

        // Store chart and series references
        chartRef.current = chart;
        seriesRef.current = candlestickSeries;
        
        // Initialize priceLines array
        chart.priceLines = [];
        
        setSeriesReady(true);
        setDataLoaded(false);

        // Subscribe to crosshair movement for price display
        chart.subscribeCrosshairMove(param => {
          if (param.time && param.seriesData.get(candlestickSeries)) {
            const data = param.seriesData.get(candlestickSeries);
            const price = data.close || data.value;
            setCurrentPrice(price ? `$${price.toFixed(4)}` : '');
          } else {
            setCurrentPrice('');
          }
        });

        // Subscribe to viewport changes for dynamic marker rendering
        let viewportUpdateTimeout;
        chart.timeScale().subscribeVisibleTimeRangeChange(() => {
          // Debounce viewport updates to avoid excessive marker recreation
          clearTimeout(viewportUpdateTimeout);
          viewportUpdateTimeout = setTimeout(() => {
            console.log('🔄 Viewport changed, checking if TWAP markers should be updated:', {
              dataLoaded,
              processedOrdersLength: processedOrders.length,
              hasChart: !!chartRef.current,
              hasSeries: !!seriesRef.current
            });
            
            if (dataLoaded && processedOrders.length > 0) {
              console.log('🔄 Viewport changed, updating TWAP markers...');
              createPersistentTwapMarkers();
            } else {
              console.log('⚠️ Viewport changed but conditions not met for TWAP marker update:', {
                dataLoaded,
                processedOrdersLength: processedOrders.length
              });
            }
          }, 150); // 150ms debounce
        });

        // Handle window resize with proper debouncing
        let resizeTimeout;
        const handleResize = () => {
          clearTimeout(resizeTimeout);
          resizeTimeout = setTimeout(() => {
            if (chartContainerRef.current && chart) {
              const newWidth = chartContainerRef.current.clientWidth;
              const headerHeight = chartContainerRef.current.querySelector('.chart-header')?.offsetHeight || 0;
              const newChartHeight = chartHeight - headerHeight;
              
              // Ensure minimum chart area height for time scale visibility
              const minChartAreaHeight = 350;
              const finalChartHeight = Math.max(newChartHeight, minChartAreaHeight);
              
              console.log('🔄 Resizing chart to:', { 
                width: newWidth, 
                totalHeight: chartHeight,
                headerHeight: headerHeight,
                chartHeight: newChartHeight,
                finalChartHeight: finalChartHeight,
                hasEnoughSpace: finalChartHeight >= minChartAreaHeight
              });
              
              chart.applyOptions({
                width: newWidth,
                height: finalChartHeight,
              });
              
              // Force chart to recalculate layout
              chart.resize(newWidth, finalChartHeight);
            }
          }, 100); // Debounce resize events
        };

        window.addEventListener('resize', handleResize);
        
        // Create ResizeObserver for container size changes
        const resizeObserver = new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (entry.target === chartContainerRef.current) {
              handleResize();
            }
          }
        });
        
        if (chartContainerRef.current) {
          resizeObserver.observe(chartContainerRef.current);
        }

        // Cleanup function
        return () => {
          window.removeEventListener('resize', handleResize);
          clearTimeout(resizeTimeout);
          resizeObserver.disconnect();
          // Cancel any pending requests
          if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
          }
          // Remove price line series
          if (chart.priceLines) {
            chart.priceLines.forEach(priceLine => {
              chart.removeSeries(priceLine);
            });
            chart.priceLines = [];
          }
          // Clean up markers
          if (markersRef.current) {
            markersRef.current.setMarkers([]);
            markersRef.current = null;
          }
          if (tradeMarkersRef.current) {
            tradeMarkersRef.current.setMarkers([]);
            tradeMarkersRef.current = null;
          }
          chart.remove();
          chartRef.current = null;
          seriesRef.current = null;
          setSeriesReady(false);
          setDataLoaded(false);
        };
      } catch (error) {
        console.error('Error creating chart:', error);
      }
    }
  }, []);

  // Fetch and update data when selectedToken changes
  useEffect(() => {
    const updateChartData = async () => {
      console.log('🔄 updateChartData called with:', {
        hasChart: !!chartRef.current,
        hasSeries: !!seriesRef.current,
        selectedToken,
        timeWindow,
        selectedTimeframe
      });

      if (!chartRef.current || !seriesRef.current) {
        console.log('❌ Chart or series not ready, skipping update');
        return;
      }

      // Reset chart state when token changes
      console.log('🧹 Resetting chart for new token:', selectedToken);
      resetChart();

      if (!selectedToken || selectedToken === 'all') {
        console.log('❌ No specific token selected, chart cleared');
        return;
      }

      try {
        // Cancel any previous request
        if (abortControllerRef.current) {
          console.log('🛑 Cancelling previous request');
          abortControllerRef.current.abort();
        }

        // Create new abort controller
        abortControllerRef.current = new AbortController();

        console.log('📡 Fetching pricing data...');
        const pricingData = await fetchPricingData(selectedToken, timeWindow, selectedTimeframe);
        
        console.log('📊 Pricing data received:', {
          length: pricingData.length,
          isEmpty: pricingData.length === 0,
          firstItem: pricingData[0],
          lastItem: pricingData[pricingData.length - 1]
        });

        if (pricingData.length === 0) {
          console.warn('⚠️ No pricing data available for token:', selectedToken);
          // Show a message on the chart that no data is available
          resetChart();
          return;
        }

        // Update the chart with new data
        seriesRef.current.setData(pricingData);
        setDataLoaded(true);

        // Add order markers and price lines
        if (processedOrders.length > 0) {
          console.log('📊 Adding order markers for:', processedOrders.length, 'processed orders (from', orders.length, 'original)');
          createOrderMarkers(); // Re-enabled for horizontal price lines
        }

        // Always create TWAP markers after data is loaded
        if (processedOrders.filter(o => o.isTwap).length > 0) {
          console.log('🎯 Creating TWAP markers after data load');
          createPersistentTwapMarkers();
        }

        // Create ladder markers for open limit buy orders (grouped by 5)
        if (processedOrders.filter(o => o.type === 'open' && o.side === 'buy' && !o.isTwap).length > 0) {
          console.log('🎯 Creating ladder markers after data load');
          createLadderMarkers();
        }

        // Fit content to show all data
        chartRef.current.timeScale().fitContent();

      } catch (error) {
        console.error('❌ Error updating chart data:', error);
        setDataLoaded(false);
        setCurrentPrice('');
      } finally {
        console.log('🏁 updateChartData completed');
      }
    };

    updateChartData();
  }, [selectedToken, timeWindow, selectedTimeframe, processedOrders, createOrderMarkers, resetChart]); // Updated dependencies

  // Separate effect to handle token changes specifically
  useEffect(() => {
    if (chartRef.current && seriesRef.current) {
      console.log('🔄 Token changed to:', selectedToken);
      resetChart();
    }
  }, [selectedToken, resetChart]);

  // Create order markers when orders change
  useEffect(() => {
    if (chartRef.current && seriesRef.current && seriesReady && dataLoaded && processedOrders.length > 0 && selectedToken && selectedToken !== 'all') {
      console.log('🎯 Creating order markers for token:', selectedToken);
      createOrderMarkers(); // Re-enabled for horizontal price lines
    }
  }, [processedOrders, seriesReady, dataLoaded, selectedToken, createOrderMarkers]);

  // Create TWAP markers when processedOrders change (independent of other conditions)
  useEffect(() => {
    if (chartRef.current && seriesRef.current && processedOrders.filter(o => o.isTwap).length > 0) {
      console.log('🎯 Creating TWAP markers due to processedOrders change');
      createPersistentTwapMarkers();
    }
  }, [processedOrders, createPersistentTwapMarkers]);

  // Create ladder markers for open limit buy orders (grouped by 5)
  const createLadderMarkers = useCallback(() => {
    if (!chartRef.current || !seriesRef.current) return;
    
    // Get open limit buy orders
    const openLimitBuyOrders = processedOrders.filter(order => 
      order.type === 'open' && 
      order.side === 'buy' && 
      !order.isTwap
    );

    console.log('🔍 Creating ladder markers for open limit buy orders:', {
      totalOpenLimitBuy: openLimitBuyOrders.length,
      sampleOrders: openLimitBuyOrders.slice(0, 3)
    });

    if (openLimitBuyOrders.length === 0) {
      console.log('⚠️ No open limit buy orders to create ladder for');
      return;
    }

    // Group orders by price (within small tolerance) and sort by price
    const priceGroups = new Map();
    const priceTolerance = 0.0001; // 0.01% tolerance

    openLimitBuyOrders.forEach(order => {
      const price = parseFloat(order.price);
      const priceKey = Math.round(price / (price * priceTolerance));
      
      if (!priceGroups.has(priceKey)) {
        priceGroups.set(priceKey, []);
      }
      priceGroups.get(priceKey).push(order);
    });

    // Convert to array and sort by price (highest to lowest for ladder)
    const sortedGroups = Array.from(priceGroups.entries())
      .map(([priceKey, orders]) => ({
        price: parseFloat(orders[0].price),
        orders: orders,
        count: orders.length
      }))
      .sort((a, b) => b.price - a.price); // Highest price first

    console.log('🔍 Price groups for ladder:', {
      totalGroups: sortedGroups.length,
      groups: sortedGroups.map(g => ({
        price: g.price,
        count: g.count,
        totalSize: g.orders.reduce((sum, o) => sum + parseFloat(o.size), 0)
      }))
    });

    // Create ladder markers (group by 5)
    const ladderMarkers = [];
    const groupSize = 5;
    
    for (let i = 0; i < sortedGroups.length; i += groupSize) {
      const group = sortedGroups.slice(i, i + groupSize);
      const groupIndex = Math.floor(i / groupSize);
      
      group.forEach((priceGroup, priceIndex) => {
        const orderTime = new Date(priceGroup.orders[0].timestamp).getTime() / 1000;
        const price = priceGroup.price;
        
        // Create ladder marker
        const marker = {
          time: orderTime,
          position: 'inBar',
          color: '#10b981', // Green for buy orders
          shape: 'circle',
          size: 2, // Slightly larger for ladder visibility
          text: `${priceGroup.count} orders` // Show order count
        };
        
        ladderMarkers.push(marker);
        
        console.log('🎯 Creating ladder marker:', {
          groupIndex,
          priceIndex,
          price,
          orderCount: priceGroup.count,
          totalSize: priceGroup.orders.reduce((sum, o) => sum + parseFloat(o.size), 0),
          marker
        });
      });
    }

    console.log('🎯 Final ladder markers:', {
      totalMarkers: ladderMarkers.length,
      groups: Math.ceil(sortedGroups.length / groupSize)
    });

    // Add ladder markers to existing markers
    if (ladderMarkers.length > 0) {
      try {
        // Create a separate series for ladder markers
        const ladderSeries = chartRef.current.addSeries(LineSeries, {
          color: 'transparent',
          lineWidth: 0,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        });
        
        // Set ladder markers on the series
        const ladderMarkersRef = createSeriesMarkers(ladderSeries, ladderMarkers);
        
        console.log('✅ Created ladder markers:', {
          totalMarkers: ladderMarkers.length,
          markersRef: ladderMarkersRef
        });
        
        // Store reference for cleanup
        if (!chartRef.current.ladderMarkers) {
          chartRef.current.ladderMarkers = [];
        }
        chartRef.current.ladderMarkers.push(ladderMarkersRef);
        
      } catch (error) {
        console.error('❌ Error creating ladder markers:', error);
      }
    }
  }, [processedOrders]);

  // Create ladder markers when processedOrders change (independent of other conditions)
  useEffect(() => {
    if (chartRef.current && seriesRef.current && processedOrders.filter(o => o.type === 'open' && o.side === 'buy' && !o.isTwap).length > 0) {
      console.log('🎯 Creating ladder markers due to processedOrders change');
      createLadderMarkers();
    }
  }, [processedOrders, createLadderMarkers]);

  // Add trade markers when trades change
  const addTradeMarkers = useCallback((trades) => {
    if (!chartRef.current || !seriesRef.current) return;
    
    // Get visible range to filter trades
    const visibleRange = chartRef.current.timeScale().getVisibleRange();
    if (!visibleRange) return;
    
    console.log('📈 Adding trade markers for visible range:', {
      from: new Date(visibleRange.from * 1000).toISOString(),
      to: new Date(visibleRange.to * 1000).toISOString(),
      totalTrades: trades.length
    });
    
    // Filter trades to only those within the visible range
    const visibleTrades = trades.filter(trade => {
      const tradeTime = new Date(trade.timestamp).getTime() / 1000;
      return tradeTime >= visibleRange.from && tradeTime <= visibleRange.to;
    });
    
    console.log('📊 Filtered trades for viewport:', {
      totalTrades: trades.length,
      visibleTrades: visibleTrades.length,
      reduction: trades.length - visibleTrades.length
    });
    
    console.log('📈 Adding trade markers for:', visibleTrades.length, 'trades');
    console.log('📊 Trade data sample:', visibleTrades.slice(0, 3));
    
    const markers = [];
    
    visibleTrades.forEach((trade, index) => {
      console.log(`🔍 Processing trade ${index}:`, {
        trade,
        hasSide: !!trade.side,
        side: trade.side,
        hasTimestamp: !!trade.timestamp,
        hasPrice: !!trade.price,
        hasSize: !!trade.size
      });
      
      // Skip trades with missing required data
      if (!trade.side || !trade.timestamp || !trade.price) {
        console.warn(`⚠️ Skipping trade ${index} due to missing data:`, trade);
        return;
      }
      
      const timestamp = new Date(trade.timestamp).getTime() / 1000;
      const price = parseFloat(trade.price);
      const side = trade.side.toString().toLowerCase(); // Ensure it's a string and lowercase
      
      console.log(`✅ Adding marker for trade ${index}:`, {
        timestamp,
        price,
        side,
        position: side === 'buy' ? 'belowBar' : 'aboveBar',
        color: side === 'buy' ? '#26a69a' : '#ef5350'
      });
      
      // Add marker to the collection
      markers.push({
        time: timestamp,
        position: side === 'buy' ? 'belowBar' : 'aboveBar',
        color: side === 'buy' ? '#26a69a' : '#ef5350',
        shape: side === 'buy' ? 'arrowUp' : 'arrowDown'
      });
    });
    
    // Set all markers at once using createSeriesMarkers
    if (markers.length > 0) {
      console.log(`🎯 Setting ${markers.length} trade markers on series for visible viewport`);
      try {
        // Clear existing trade markers if any
        if (tradeMarkersRef.current) {
          tradeMarkersRef.current.setMarkers([]);
        }
        // Create new markers using the proper function
        tradeMarkersRef.current = createSeriesMarkers(seriesRef.current, markers);
      } catch (error) {
        console.error('❌ Error setting trade markers:', error);
      }
    }
  }, []);

  // Add trade markers when trades change
  useEffect(() => {
    if (chartRef.current && seriesRef.current && seriesReady && dataLoaded && trades.length > 0 && selectedToken && selectedToken !== 'all') {
      console.log('📈 Adding trade markers for token:', selectedToken);
      // addTradeMarkers(trades); // Disabled trade markers to reduce visual clutter
    }
  }, [trades, seriesReady, dataLoaded, selectedToken, addTradeMarkers]);

  return (
    <div className="chart-container" style={{ width, height: `${chartHeight}px` }}>
      <div className="chart-header">
        <span className="token-name">{selectedToken}</span>
        <span className="timeframe-display">{selectedTimeframe}</span>
        {/* Performance indicator */}
        {processedOrders.length > 0 && (
          <div className="performance-indicator">
            <span className="order-count">
              {processedOrders.length} {processedOrders.some(o => o.isCluster) ? 'clusters' : 'orders'}
              {processedOrders.length !== orders.length && (
                <span className="clustering-info">
                  (from {orders.length} total)
                </span>
              )}
            </span>
          </div>
        )}
        <div className="timeframe-selector">
          {['1m', '5m', '15m', '30m', '1h', '4h', '1d'].map(tf => (
            <button
              key={tf}
              className={`timeframe-btn ${selectedTimeframe === tf ? 'active' : ''}`}
              onClick={() => setSelectedTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
        <div className="chart-size-controls">
          <button 
            className="size-btn"
            onClick={() => setChartHeight(Math.max(600, chartHeight - 50))}
            title="Decrease chart height"
          >
            -
          </button>
          <span className="size-indicator">{chartHeight}px</span>
          <button 
            className="size-btn"
            onClick={() => setChartHeight(Math.min(1200, chartHeight + 50))}
            title="Increase chart height"
          >
            +
          </button>
        </div>
        <div className="order-legend">
          <div className="legend-item">
            <div className="legend-color buy-open"></div>
            <span>Open Buy</span>
          </div>
          <div className="legend-item">
            <div className="legend-color sell-open"></div>
            <span>Open Sell</span>
          </div>
          <div className="legend-item">
            <div className="legend-color filled-buy"></div>
            <span>Filled Buy</span>
          </div>
          <div className="legend-item">
            <div className="legend-color filled-sell"></div>
            <span>Filled Sell</span>
          </div>
          <div className="legend-item">
            <div className="legend-color cancelled-buy"></div>
            <span>Cancelled Buy</span>
          </div>
          <div className="legend-item">
            <div className="legend-color cancelled-sell"></div>
            <span>Cancelled Sell</span>
          </div>
          <div className="legend-item">
            <div className="legend-color twap-buy"></div>
            <span>TWAP Buy</span>
          </div>
          <div className="legend-item">
            <div className="legend-color twap-sell"></div>
            <span>TWAP Sell</span>
          </div>
        </div>
      </div>
      <div ref={chartContainerRef} className="chart" />
      {/* Resize handle for manual chart resizing */}
      <div className="chart-resize-handle" />
      {/* Loading indicator directly under the chart */}
      {loading && (
        <div className="loading">
          <p>Loading historical orders...</p>
          {loadingProgress && loadingProgress.total > 0 && (
            <div className="loading-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(loadingProgress.current / loadingProgress.total) * 100}%` }}
                ></div>
              </div>
              <p className="progress-text">
                {loadingProgress.message} ({loadingProgress.current}/{loadingProgress.total})
              </p>
            </div>
          )}
        </div>
      )}
      {/* Placeholder message if no token is selected */}
      {!selectedToken || selectedToken === 'all' ? (
        <div className="chart-placeholder">
          <p>Select a token from the order history to view its price chart</p>
        </div>
      ) : null}
      
      {/* Order count display */}
      {orderStats.totalOpen > 0 && (
        <div className="order-stats-display" style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '8px 12px',
          borderRadius: '6px',
          fontSize: '12px',
          fontFamily: 'monospace',
          zIndex: 1000
        }}>
          <div>📊 Open Orders: {orderStats.totalOpen}</div>
          <div style={{ color: '#10b981' }}>🟢 Buy: {orderStats.openBuy}</div>
          <div style={{ color: '#ef4444' }}>🔴 Sell: {orderStats.openSell}</div>
          {orderStats.twap > 0 && (
            <div style={{ color: '#3b82f6' }}>🔵 TWAP: {orderStats.twap}</div>
          )}
        </div>
      )}
      
      {!dataLoaded && selectedToken && selectedToken !== 'all' && (
        <div className="loading-placeholder" style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#9ca3af',
          fontSize: '16px',
          textAlign: 'center'
        }}>
          Loading chart data...
        </div>
      )}
      
      {dataLoaded && processedOrders.length === 0 && selectedToken && selectedToken !== 'all' && (
        <div className="no-data-placeholder" style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: '#9ca3af',
          fontSize: '16px',
          textAlign: 'center'
        }}>
          No order data available for {selectedToken}
        </div>
      )}
    </div>
  );
};

// ChartControls component for chart window controls and stats
const ChartControls = ({
  ethereumAddress,
  searchTerm,
  setSearchTerm,
  debouncedSearchTerm,
  filteredOrders,
  uniqueTokens,
  selectedToken,
  handleTokenFilterClick,
  fetchHistoricalOrders,
  loading,
  loadingProgress,
  orders,
  twapStats
}) => (
  <div className="chart-controls">
    <h2>Order History</h2>
    <p>Showing orders for: {ethereumAddress}</p>
    {/* Search input for large datasets */}
    {orders.length > 100 && (
      <div className="search-container">
        <input
          type="text"
          placeholder="Search orders by token, ID, side, or status..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          className="search-input"
        />
        {debouncedSearchTerm && (
          <span className="search-results">
            Found {filteredOrders.length} results
          </span>
        )}
      </div>
    )}
    <div className="token-filter">
      <span className="filter-label">Filter by Token:</span>
      <div className="token-buttons">
        {uniqueTokens.map(token => {
          const tokenCount = orders.filter(order => order.token === token).length;
          const twapCount = orders.filter(order => order.token === token && order.isTwap).length;
          const displayCount = tokenCount > 10 ? `10/${tokenCount}` : tokenCount;
          const twapIndicator = twapCount > 0 ? ` (${twapCount} TWAP)` : '';
          return (
            <button
              key={token}
              className={`token-btn ${selectedToken === token ? 'active' : ''}`}
              onClick={() => handleTokenFilterClick(token)}
            >
              {token} ({displayCount}{twapIndicator})
            </button>
          );
        })}
      </div>
    </div>
    <button
      onClick={fetchHistoricalOrders}
      className="refresh-btn"
      disabled={loading}
      style={{ marginTop: '1rem' }}
    >
      {loading ? 'Loading...' : 'Refresh'}
    </button>
    {/* Performance warning for large datasets */}
    {orders.length > 1000 && (
      <div className="performance-warning">
        <span>⚠️ Large dataset ({orders.length} orders) - clustering active</span>
      </div>
    )}
    {/* TWAP Statistics */}
    {twapStats && twapStats.total > 0 && (
      <div className="twap-stats">
        <h3>TWAP Orders Found</h3>
        <div className="twap-summary">
          <p>Total TWAP orders: <strong>{twapStats.total}</strong></p>
          {twapStats.crossed > 0 && (
            <p>Crossed orders: <strong>{twapStats.crossed}</strong></p>
          )}
          {twapStats.tokens.length > 0 && (
            <div className="twap-by-token">
              <span>By token: </span>
              {twapStats.tokens.map(token => (
                <span key={token} className="twap-token-stat">
                  {token}: {twapStats.byToken[token]}
                </span>
              ))}
            </div>
          )}
          {twapStats.directions.length > 0 && (
            <div className="twap-by-direction">
              <span>By direction: </span>
              {twapStats.directions.map(direction => (
                <span key={direction} className="twap-direction-stat">
                  {direction}: {twapStats.byDirection[direction]}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    )}
  </div>
);

export default Chart; 