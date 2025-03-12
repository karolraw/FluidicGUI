import React, { useState, useRef, useEffect, useImperativeHandle } from 'react';
import { useButtonStyles } from '../../../styles/ButtonStyleProvider';

const GraphComponent = React.forwardRef((props, ref) => {
  const { onResize, lineData, onFrameAccumCountChange, onAccumulationToggle } = props;
  const buttonVariants = useButtonStyles();
  const [graphSize, setGraphSize] = useState({ width: '100%', height: 200 });
  const [isResizing, setIsResizing] = useState(false);
  const [showResizeInfo, setShowResizeInfo] = useState(false);
  const [displayChannels, setDisplayChannels] = useState({
    red: true,
    green: true,
    blue: true,
    intensity: true
  });
  const [graphData, setGraphData] = useState(null);
  
  // Cursor tracking state
  const [cursorPosition, setCursorPosition] = useState(null);
  const [showCrosshair, setShowCrosshair] = useState(false);
  
  // Frame accumulation state - internally managed but synced with parent
  const [frameAccumCount, setFrameAccumCount] = useState(10); // Default to 10 frames
  const [accumulatedFrames, setAccumulatedFrames] = useState([]);
  const [accumulatedData, setAccumulatedData] = useState(null);
  const [isAccumulating, setIsAccumulating] = useState(true);
  
  // Calibration state
  const [showCalibration, setShowCalibration] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState([
    { position: 0.250, wavelength: 450 },
    { position: 0.750, wavelength: 650 }
  ]);
  const [useCalibration, setUseCalibration] = useState(false);
  const [flipXAxis, setFlipXAxis] = useState(false);
  
  const graphContainerRef = useRef(null);
  const canvasRef = useRef(null);
  
  // Expose methods to parent component via ref
  useImperativeHandle(ref, () => ({
    // Get calibration settings
    getCalibrationSettings: () => {
      return {
        calibrationPoints: [...calibrationPoints],
        useCalibration,
        flipXAxis
      };
    },
    
    // Apply saved calibration settings
    applyCalibrationSettings: (settings) => {
      if (!settings) return false;
      
      try {
        // Apply calibration points if available
        if (settings.calibrationPoints && Array.isArray(settings.calibrationPoints)) {
          setCalibrationPoints(settings.calibrationPoints);
        }
        
        // Apply useCalibration setting if available
        if (typeof settings.useCalibration === 'boolean') {
          setUseCalibration(settings.useCalibration);
          
          // If loading calibrated settings, show the calibration panel
          if (settings.useCalibration) {
            setShowCalibration(true);
          }
        }
        
        // Apply flip X axis setting if available
        if (typeof settings.flipXAxis === 'boolean') {
          setFlipXAxis(settings.flipXAxis);
        }
        
        return true;
      } catch (error) {
        console.error('Error applying calibration settings:', error);
        return false;
      }
    }
  }));
  
  // Update graph when line data changes
  useEffect(() => {
    if (lineData?.pixelData) {
      // Always keep the latest raw frame data for display when not accumulating
      setGraphData(lineData.pixelData);
      
      if (isAccumulating) {
        // Add new frame to accumulation buffer
        setAccumulatedFrames(prev => {
          const newFrames = [...prev, lineData.pixelData];
          
          // If we've reached our target frame count, process the accumulated data
          if (newFrames.length >= frameAccumCount) {
            // Sum the color data across all frames
            const summedData = sumFrameData(newFrames);
            
            // Update accumulated data state
            setAccumulatedData(summedData);
            
            // Draw the accumulated data
            drawGraph(summedData);
            
            // Reset the accumulation buffer
            return [];
          }
          
          return newFrames;
        });
      } else {
        // If not accumulating, just display the raw frame
        drawGraph(lineData.pixelData);
      }
    }
  }, [lineData, isAccumulating, frameAccumCount, useCalibration, calibrationPoints, flipXAxis]);
  
  // When accumulated data changes, draw it
  useEffect(() => {
    if (accumulatedData && isAccumulating) {
      drawGraph(accumulatedData);
    }
  }, [accumulatedData, useCalibration, calibrationPoints, flipXAxis]);
  
  // Sum pixel data across multiple frames
  const sumFrameData = (frames) => {
    if (!frames.length) return null;
    
    // Use the first frame as a template for structure
    const template = frames[0];
    
    // Initialize arrays for summed values
    const summedRed = Array(template.red.length).fill(0);
    const summedGreen = Array(template.green.length).fill(0);
    const summedBlue = Array(template.blue.length).fill(0);
    const summedIntensity = Array(template.intensity.length).fill(0);
    
    // Sum values across all frames
    frames.forEach(frame => {
      frame.red.forEach((val, i) => summedRed[i] += val);
      frame.green.forEach((val, i) => summedGreen[i] += val);
      frame.blue.forEach((val, i) => summedBlue[i] += val);
      frame.intensity.forEach((val, i) => summedIntensity[i] += val);
    });

    // Return the summed data structure
    return {
      timestamp: Date.now(),
      positions: template.positions, // Positions remain the same
      red: summedRed,
      green: summedGreen,
      blue: summedBlue,
      intensity: summedIntensity,
      lineLength: template.lineLength,
      frameCount: frames.length // Add count of frames that were summed
    };
  };
  
  // Convert position to wavelength using calibration points
  const positionToWavelength = (position) => {
    if (!useCalibration || calibrationPoints.length < 2) {
      return position;
    }
    
    // Sort calibration points by position
    const sortedPoints = [...calibrationPoints].sort((a, b) => a.position - b.position);
    
    // Find the two calibration points that surround the given position
    let p1, p2;
    for (let i = 0; i < sortedPoints.length - 1; i++) {
      if (position >= sortedPoints[i].position && position <= sortedPoints[i + 1].position) {
        p1 = sortedPoints[i];
        p2 = sortedPoints[i + 1];
        break;
      }
    }
    
    // If position is outside the calibration range, use extrapolation
    if (!p1 || !p2) {
      if (position < sortedPoints[0].position) {
        // Extrapolate below the first point
        // Use the first two points for the slope calculation
        p1 = sortedPoints[0];
        p2 = sortedPoints[1];
        // Calculate the slope between first two calibration points
        const slope = (p2.wavelength - p1.wavelength) / (p2.position - p1.position);
        // Extrapolate using y = mx + b formula
        return p1.wavelength + slope * (position - p1.position);
      } else {
        // Extrapolate above the last point
        // Use the last two points for the slope calculation
        p1 = sortedPoints[sortedPoints.length - 2];
        p2 = sortedPoints[sortedPoints.length - 1];
        // Calculate the slope between last two calibration points
        const slope = (p2.wavelength - p1.wavelength) / (p2.position - p1.position);
        // Extrapolate using y = mx + b formula
        return p2.wavelength + slope * (position - p2.position);
      }
    }
    
    // Linear interpolation between the two calibration points
    const t = (position - p1.position) / (p2.position - p1.position);
    return p1.wavelength + t * (p2.wavelength - p1.wavelength);
  };
  
  // Handle changing the frame accumulation count
  const handleFrameCountChange = (e) => {
    const count = parseInt(e.target.value);
    if (!isNaN(count) && count > 0) {
      setFrameAccumCount(count);
      // Reset accumulation when count changes
      setAccumulatedFrames([]);
      setAccumulatedData(null);
      
      // Notify parent of change
      if (onFrameAccumCountChange) {
        onFrameAccumCountChange(count);
      }
    }
  };
  
  // Toggle accumulation mode
  const toggleAccumulation = () => {
    const newValue = !isAccumulating;
    setIsAccumulating(newValue);
    // Reset accumulated data when toggling
    setAccumulatedFrames([]);
    setAccumulatedData(null);
    
    // Notify parent of change
    if (onAccumulationToggle) {
      onAccumulationToggle(newValue);
    }
  };
  
  // Toggle calibration controls
  const toggleCalibration = () => {
    setShowCalibration(!showCalibration);
  };
  
  // Toggle using calibration
  const toggleUseCalibration = () => {
    setUseCalibration(!useCalibration);
  };
  
  // Toggle flip X axis
  const toggleFlipXAxis = () => {
    setFlipXAxis(!flipXAxis);
  };
  
  // Update calibration point
  const updateCalibrationPoint = (index, field, value) => {
    const numValue = parseFloat(value);
    if (isNaN(numValue)) return;
    
    // Format position values to 3 decimal places
    const formattedValue = field === 'position' ? 
      parseFloat(numValue.toFixed(3)) : 
      numValue;
    
    setCalibrationPoints(points => {
      const newPoints = [...points];
      newPoints[index] = {
        ...newPoints[index],
        [field]: formattedValue
      };
      return newPoints;
    });
  };
  
  // Initialize and resize the canvas when graph size changes
  useEffect(() => {
    if (canvasRef.current) {
      const canvas = canvasRef.current;
      const container = graphContainerRef.current;
      
      if (container) {
        // Set canvas size to match container
        canvas.width = container.clientWidth;
        canvas.height = container.clientHeight;
        
        // Redraw graph with new size
        if (isAccumulating && accumulatedData) {
          drawGraph(accumulatedData);
        } else if (graphData) {
          drawGraph(graphData);
        }
      }
    }
  }, [graphSize, graphData, accumulatedData, isAccumulating, useCalibration, calibrationPoints, flipXAxis]);
  
  // Draw the graph based on pixel data
  const drawGraph = (data) => {
    if (!canvasRef.current || !data) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    
    // Clear the canvas
    ctx.clearRect(0, 0, width, height);
    
    // Draw background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, width, height);
    
    // Draw grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    
    // Horizontal grid lines (at 25%, 50%, 75%)
    for (let i = 1; i < 4; i++) {
      const y = height * (i / 4);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    
    // Vertical grid lines (at 25%, 50%, 75%)
    for (let i = 1; i < 4; i++) {
      const x = width * (i / 4);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    
    // Calculate min and max wavelength values for calibration upfront
    let minWavelength, maxWavelength;
    if (useCalibration && calibrationPoints.length >= 2) {
      const wavelengths = calibrationPoints.map(p => p.wavelength);
      minWavelength = Math.min(...wavelengths);
      maxWavelength = Math.max(...wavelengths);
    }
    
    // Set line styles for different channels
    const styles = {
      red: { color: 'rgba(255, 0, 0, 0.8)', width: 1.5 },
      green: { color: 'rgba(0, 255, 0, 0.8)', width: 1.5 },
      blue: { color: 'rgba(0, 0, 255, 0.8)', width: 1.5 },
      intensity: { color: 'rgba(255, 255, 255, 0.8)', width: 2 }
    };
    
    // Find max values for scaling
    const maxRed = Math.max(...data.red, 1);
    const maxGreen = Math.max(...data.green, 1);
    const maxBlue = Math.max(...data.blue, 1);
    const maxIntensity = Math.max(...data.intensity, 1);
    
    // Plot each enabled channel
    Object.entries(displayChannels).forEach(([channel, isEnabled]) => {
      if (!isEnabled) return;
      
      const values = data[channel];
      const maxValue = channel === 'red' ? maxRed : 
                      channel === 'green' ? maxGreen : 
                      channel === 'blue' ? maxBlue : maxIntensity;
      
      // Set line style
      ctx.strokeStyle = styles[channel].color;
      ctx.lineWidth = styles[channel].width;
      
      // Begin the path
      ctx.beginPath();
      
      // Draw the line
      for (let i = 0; i < values.length; i++) {
        // Calculate x position, applying flip if enabled
        let xPos = data.positions[i];
        if (flipXAxis) {
          xPos = 1 - xPos; // Invert position (0 becomes 1, 1 becomes 0)
        }
        
        // Convert to pixel coordinates
        const x = xPos * width;
        
        // Invert Y since canvas 0,0 is top-left
        const y = height - (values[i] / maxValue) * height;
        
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      }
      
      // Draw the path
      ctx.stroke();
    });
    
    // Draw timestamp and status information
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.font = '10px monospace';
    ctx.textAlign = 'left';
    
    // Show time and accumulation status
    const timeText = `Time: ${new Date(data.timestamp).toLocaleTimeString()}`;
    const statusText = isAccumulating 
      ? `Accumulating: ${accumulatedFrames.length}/${frameAccumCount} frames` 
      : 'Live data';
    
    ctx.fillText(timeText, 5, 15);
    ctx.fillText(statusText, width - 150, 15);
    
    // Draw calibration status if enabled
    if (useCalibration) {
      ctx.fillText('Calibrated', width - 150, 45);
    }
    
    // Draw frame count if this is accumulated data
    if (data.frameCount) {
      ctx.fillText(`Summed ${data.frameCount} frames`, width - 150, 30);
    }
    
    // Draw channel legend
    const legendStartY = 30;
    const legendSpacing = 15;
    
    if (displayChannels.red) {
      ctx.fillStyle = styles.red.color;
      ctx.fillText(`Red: ${Math.round(data.red.reduce((a, b) => a + b, 0) / data.red.length)}`, 5, legendStartY);
    }
    
    if (displayChannels.green) {
      ctx.fillStyle = styles.green.color;
      ctx.fillText(`Green: ${Math.round(data.green.reduce((a, b) => a + b, 0) / data.green.length)}`, 5, legendStartY + legendSpacing);
    }
    
    if (displayChannels.blue) {
      ctx.fillStyle = styles.blue.color;
      ctx.fillText(`Blue: ${Math.round(data.blue.reduce((a, b) => a + b, 0) / data.blue.length)}`, 5, legendStartY + legendSpacing * 2);
    }
    
    if (displayChannels.intensity) {
      ctx.fillStyle = styles.intensity.color;
      ctx.fillText(`Intensity: ${(data.intensity.reduce((a, b) => a + b, 0) / data.intensity.length).toFixed(2)}`, 5, legendStartY + legendSpacing * 3);
    }
    
    // Draw wavelength axis labels if calibration is enabled (unified section)
    if (useCalibration && minWavelength !== undefined && maxWavelength !== undefined) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      
      // Clear the bottom area where labels will go
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)'; // Match background color
      ctx.fillRect(0, height - 20, width, 20);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; // Reset text color
      
      // Draw axis labels at regular position intervals (0%, 25%, 50%, 75%, 100%)
      // but show the corresponding wavelength values
      for (let i = 0; i <= 4; i++) {
        const position = i / 4; // Regular positions (0, 0.25, 0.5, 0.75, 1)
        
        // Apply flip if enabled
        const displayPosition = flipXAxis ? 1 - position : position;
        const x = displayPosition * width;
        
        // Convert position to wavelength using calibration
        const wavelength = positionToWavelength(position);
        
        ctx.fillText(`${Math.round(wavelength)}nm`, x, height - 5);
      }
    }
    
    // Draw calibration points if enabled
    if (useCalibration) {
      calibrationPoints.forEach(point => {
        // Apply flip if enabled
        const displayPosition = flipXAxis ? 1 - point.position : point.position;
        // Draw vertical line at calibration point position
        const x = displayPosition * width;
        
        ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        
        // Draw wavelength label at the calibration point
        ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
        ctx.font = '10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${point.wavelength}nm`, x, height - 20); // Higher position to avoid overlap
      });
    }
    
    // Draw crosshair at cursor position
    if (showCrosshair && cursorPosition) {
      const { x, y } = cursorPosition;
      
      if (x >= 0 && x <= width && y >= 0 && y <= height) {
        // Draw vertical line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]); // Dashed line
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
        
        // Draw horizontal line
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.setLineDash([]); // Reset line style
        
        // Calculate and display wavelength at cursor position
        const position = x / width; // Normalize cursor position (0-1)
        
        // Apply flip if needed to get the actual data position
        const dataPosition = flipXAxis ? 1 - position : position;
        
        // Determine wavelength based on cursor position
        let wavelength;
        if (useCalibration) {
          wavelength = positionToWavelength(dataPosition);
        } else {
          wavelength = dataPosition; // Just show the position value when not calibrated
        }
        
        // Calculate y-values at the cursor position
        let valueText = '';
        
        if (data && data.positions && data.positions.length > 0) {
          // Find the nearest data point to the cursor
          const positionIndex = findNearestPositionIndex(data.positions, dataPosition);
          
          // Build value text based on active channels
          const channelTexts = [];
          if (displayChannels.red) {
            channelTexts.push(`R:${Math.round(data.red[positionIndex])}`);
          }
          if (displayChannels.green) {
            channelTexts.push(`G:${Math.round(data.green[positionIndex])}`);
          }
          if (displayChannels.blue) {
            channelTexts.push(`B:${Math.round(data.blue[positionIndex])}`);
          }
          if (displayChannels.intensity) {
            channelTexts.push(`I:${data.intensity[positionIndex].toFixed(1)}`);
          }
          
          valueText = channelTexts.join(', ');
        }
        
        // Create a background for the text for better readability
        const wavelengthText = useCalibration ? `${wavelength.toFixed(1)}nm` : `Pos: ${wavelength.toFixed(3)}`;
        
        // Draw text background
        const textWidth = ctx.measureText(wavelengthText).width + 10;
        const valueTextWidth = ctx.measureText(valueText).width + 10;
        
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x - textWidth/2, height - 45, textWidth, 20);
        
        if (valueText) {
          ctx.fillRect(x - valueTextWidth/2, 5, valueTextWidth, 20);
        }
        
        // Draw wavelength text below cursor
        ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.textAlign = 'center';
        ctx.fillText(wavelengthText, x, height - 30);
        
        // Draw value text above cursor
        if (valueText) {
          ctx.fillText(valueText, x, 20);
        }
      }
    }
  };
  
  // Helper to find the index of the nearest position value to a given position
  const findNearestPositionIndex = (positions, targetPosition) => {
    if (!positions || positions.length === 0) return -1;
    
    let nearestIndex = 0;
    let minDistance = Math.abs(positions[0] - targetPosition);
    
    for (let i = 1; i < positions.length; i++) {
      const distance = Math.abs(positions[i] - targetPosition);
      if (distance < minDistance) {
        minDistance = distance;
        nearestIndex = i;
      }
    }
    
    return nearestIndex;
  };
  
  // Toggle display of a specific channel
  const toggleChannel = (channel) => {
    setDisplayChannels(prev => ({
      ...prev,
      [channel]: !prev[channel]
    }));
  };
  
  // Handle mouse movement over the graph
  const handleMouseMove = (e) => {
    if (!graphContainerRef.current) return;
    
    // Get canvas bounds
    const rect = graphContainerRef.current.getBoundingClientRect();
    
    // Calculate cursor position relative to canvas
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Update cursor position state
    setCursorPosition({ x, y });
    
    // Redraw the graph with crosshair
    if (isAccumulating && accumulatedData) {
      drawGraph(accumulatedData);
    } else if (graphData) {
      drawGraph(graphData);
    }
  };
  
  // Handle mouse enter/leave events
  const handleMouseEnter = () => {
    setShowCrosshair(true);
  };
  
  const handleMouseLeave = () => {
    setShowCrosshair(false);
    setCursorPosition(null);
    
    // Redraw the graph without crosshair
    if (isAccumulating && accumulatedData) {
      drawGraph(accumulatedData);
    } else if (graphData) {
      drawGraph(graphData);
    }
  };
  
  // Similar resize functionality as before
  const handleResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Get initial coordinates and size
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = graphContainerRef.current?.clientWidth || 400;
    const startHeight = graphContainerRef.current?.clientHeight || graphSize.height;
    
    // Show resize feedback
    setIsResizing(true);
    setShowResizeInfo(true);
    
    // Define move handler
    function handleMouseMove(moveEvent) {
      const deltaY = moveEvent.clientY - startY;
      
      // Only adjust height, keep width as 100%
      const newHeight = Math.max(100, startHeight + deltaY);
      
      // Update graph size
      const newSize = {
        width: '100%',  // Keep width as 100% for responsive behavior
        height: Math.round(newHeight)
      };
      
      setGraphSize(newSize);
      
      // Notify parent if needed
      if (onResize) {
        onResize(newSize);
      }
      
      // Prevent default to avoid text selection during resize
      moveEvent.preventDefault();
    }
    
    // Define up handler
    function handleMouseUp() {
      // Clean up
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      
      setIsResizing(false);
      setTimeout(() => setShowResizeInfo(false), 800);
    }
    
    // Attach handlers to document to capture events outside component
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };
  
  const styles = {
    container: {
      backgroundColor: 'rgba(0, 0, 0, 0.2)',
      padding: '10px',
      borderRadius: '4px',
      position: 'relative',
      border: isResizing ? '1px dashed #4CAF50' : 'none',
    },
    title: {
      margin: '0 0 10px 0',
      fontSize: '14px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center'
    },
    controls: {
      display: 'flex',
      gap: '5px',
      alignItems: 'center',
    },
    frameCountControl: {
      display: 'flex',
      alignItems: 'center',
      marginBottom: '10px',
      gap: '8px'
    },
    frameCountLabel: {
      fontSize: '12px',
      color: 'rgba(255, 255, 255, 0.8)'
    },
    frameCountInput: {
      width: '50px',
      padding: '2px 4px',
      backgroundColor: 'rgba(30, 30, 30, 0.8)',
      color: 'white',
      border: '1px solid rgba(80, 80, 80, 0.5)',
      borderRadius: '3px',
      fontSize: '12px'
    },
    calibrationContainer: {
      marginBottom: '10px',
      padding: '8px',
      backgroundColor: 'rgba(0, 0, 0, 0.3)',
      borderRadius: '4px'
    },
    calibrationHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '8px'
    },
    calibrationTitle: {
      fontSize: '12px',
      color: 'rgba(255, 255, 255, 0.9)',
      margin: 0
    },
    calibrationCheckbox: {
      marginLeft: '8px'
    },
    calibrationPoints: {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px'
    },
    calibrationPoint: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: '6px'
    },
    calibrationLabel: {
      fontSize: '11px',
      color: 'rgba(255, 255, 255, 0.7)',
      width: '40px'
    },
    calibrationInput: {
      width: '60px',
      padding: '2px 4px',
      backgroundColor: 'rgba(30, 30, 30, 0.8)',
      color: 'white',
      border: '1px solid rgba(80, 80, 80, 0.5)',
      borderRadius: '3px',
      fontSize: '11px'
    },
    graphView: {
      width: graphSize.width,
      height: `${graphSize.height}px`,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      position: 'relative',
      overflow: 'hidden'
    },
    canvas: {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%'
    },
    resizeHandle: {
      position: 'absolute',
      bottom: '0',
      right: '0',
      width: '20px',
      height: '20px',
      cursor: 'ns-resize', // Only allow vertical resizing
      zIndex: 100,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: 'rgba(60, 60, 60, 0.8)',
      borderTop: '1px solid rgba(180, 180, 180, 0.7)',
      borderLeft: '1px solid rgba(180, 180, 180, 0.7)',
      borderTopLeftRadius: '4px',
    },
    resizeInfo: {
      position: 'absolute',
      right: '25px',
      bottom: '25px',
      padding: '2px 6px',
      background: 'rgba(0, 0, 0, 0.7)',
      color: 'white',
      borderRadius: '3px',
      fontSize: '11px',
      zIndex: 100
    },
    channelToggles: {
      display: 'flex',
      gap: '5px'
    },
    channelButton: {
      fontSize: '10px',
      padding: '2px 5px',
      borderRadius: '3px',
      cursor: 'pointer',
      border: '1px solid rgba(255, 255, 255, 0.3)',
      backgroundColor: 'rgba(30, 30, 30, 0.7)'
    },
    noData: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color: 'rgba(255, 255, 255, 0.5)',
      fontSize: '12px'
    }
  };
  
  // Return the component JSX
  return (
    <div style={styles.container}>
      <div style={styles.title}>
        <h3 style={{ margin: 0 }}>Intensity Graph</h3>
        <div style={styles.channelToggles}>
          <button 
            style={{
              ...styles.channelButton,
              color: displayChannels.red ? 'rgb(255, 100, 100)' : 'rgba(255, 100, 100, 0.4)',
              borderColor: displayChannels.red ? 'rgb(255, 100, 100)' : 'rgba(255, 100, 100, 0.2)'
            }}
            onClick={() => toggleChannel('red')}
          >
            R
          </button>
          <button 
            style={{
              ...styles.channelButton,
              color: displayChannels.green ? 'rgb(100, 255, 100)' : 'rgba(100, 255, 100, 0.4)',
              borderColor: displayChannels.green ? 'rgb(100, 255, 100)' : 'rgba(100, 255, 100, 0.2)'
            }}
            onClick={() => toggleChannel('green')}
          >
            G
          </button>
          <button 
            style={{
              ...styles.channelButton,
              color: displayChannels.blue ? 'rgb(100, 100, 255)' : 'rgba(100, 100, 255, 0.4)',
              borderColor: displayChannels.blue ? 'rgb(100, 100, 255)' : 'rgba(100, 100, 255, 0.2)'
            }}
            onClick={() => toggleChannel('blue')}
          >
            B
          </button>
          <button 
            style={{
              ...styles.channelButton,
              color: displayChannels.intensity ? 'rgb(220, 220, 220)' : 'rgba(220, 220, 220, 0.4)',
              borderColor: displayChannels.intensity ? 'rgb(220, 220, 220)' : 'rgba(220, 220, 220, 0.2)'
            }}
            onClick={() => toggleChannel('intensity')}
          >
            I
          </button>
          <button 
            style={{
              ...styles.channelButton,
              color: 'rgb(255, 255, 100)',
              borderColor: showCalibration ? 'rgb(255, 255, 100)' : 'rgba(255, 255, 100, 0.2)',
              backgroundColor: showCalibration ? 'rgba(60, 60, 0, 0.6)' : 'rgba(30, 30, 30, 0.7)'
            }}
            onClick={toggleCalibration}
            title="Toggle calibration controls"
          >
            Cal
          </button>
        </div>
      </div>
      
      <div style={styles.frameCountControl}>
        <div style={styles.frameCountLabel}>Frame accumulation:</div>
        <input 
          type="number" 
          min="1" 
          max="100"
          value={frameAccumCount}
          onChange={handleFrameCountChange}
          style={styles.frameCountInput}
        />
        <button 
          style={{
            ...buttonVariants.smallIconButton,
            backgroundColor: isAccumulating ? 'rgba(255, 165, 0, 0.7)' : undefined
          }}
          onClick={toggleAccumulation}
          title={isAccumulating ? "Switch to live data" : "Switch to frame accumulation"}
        >
          {isAccumulating ? "Accumulating" : "Live"}
        </button>
      </div>
      
      {showCalibration && (
        <div style={styles.calibrationContainer}>
          <div style={styles.calibrationHeader}>
            <h4 style={styles.calibrationTitle}>Wavelength Calibration</h4>
            <div>
              <label style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.7)' }}>
                <input 
                  type="checkbox" 
                  checked={useCalibration}
                  onChange={toggleUseCalibration}
                  style={styles.calibrationCheckbox}
                />
                Use Calibration
              </label>
            </div>
          </div>
          
          <div style={styles.calibrationPoints}>
            {calibrationPoints.map((point, index) => (
              <div key={index} style={styles.calibrationPoint}>
                <div style={styles.calibrationLabel}>Point {index+1}:</div>
                <div>
                  <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.7)', marginRight: '4px' }}>Pos:</span>
                  <input 
                    type="number" 
                    min="0" 
                    max="1" 
                    step="0.001"
                    value={point.position}
                    onChange={(e) => updateCalibrationPoint(index, 'position', e.target.value)}
                    style={styles.calibrationInput}
                  />
                </div>
                <div>
                  <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.7)', marginRight: '4px' }}>λ:</span>
                  <input 
                    type="number" 
                    min="0" 
                    max="2000" 
                    step="1"
                    value={point.wavelength}
                    onChange={(e) => updateCalibrationPoint(index, 'wavelength', e.target.value)}
                    style={styles.calibrationInput}
                  />
                  <span style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.7)', marginLeft: '2px' }}>nm</span>
                </div>
              </div>
            ))}
            
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center' }}>
              <label style={{ fontSize: '11px', color: 'rgba(255, 255, 255, 0.7)', display: 'flex', alignItems: 'center' }}>
                <input 
                  type="checkbox" 
                  checked={flipXAxis}
                  onChange={toggleFlipXAxis}
                  style={{ marginRight: '5px' }}
                />
                Flip X-Axis
              </label>
            </div>
          </div>
        </div>
      )}
      
      <div 
        ref={graphContainerRef}
        style={styles.graphView}
        onMouseMove={handleMouseMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <canvas
          ref={canvasRef}
          style={styles.canvas}
        />
        
        {!graphData && !accumulatedData && (
          <div style={styles.noData}>
            Draw a line on the camera feed to see intensity data
          </div>
        )}
        
        {/* Resize info overlay */}
        {showResizeInfo && (
          <div style={styles.resizeInfo}>
            Height: {graphSize.height}px
          </div>
        )}
        
        {/* Resize handle */}
        <div 
          style={styles.resizeHandle}
          onMouseDown={handleResizeStart}
          title="Resize graph height"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path 
              d="M2,6 L10,6 M2,9 L10,9" 
              stroke="white" 
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
    </div>
  );
});

// Add display name for debugging
GraphComponent.displayName = 'GraphComponent';

export default GraphComponent; 