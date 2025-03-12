import React, { useState, useRef, useEffect, useImperativeHandle } from 'react';
import { useButtonStyles } from '../../../styles/ButtonStyleProvider';

const CameraComponent = React.forwardRef((props, ref) => {
  const { onResize, onLineDataChange } = props;
  const buttonVariants = useButtonStyles();
  
  // Camera view state
  const [cameraSize, setCameraSize] = useState({ width: 640, height: 480 });
  const [isResizing, setIsResizing] = useState(false);
  const [showResizeInfo, setShowResizeInfo] = useState(false);
  
  // Camera operation state
  const [availableCameras, setAvailableCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [showCameraSettings, setShowCameraSettings] = useState(false);
  const [showAdvancedCapabilities, setShowAdvancedCapabilities] = useState(false);
  const [cameraCapabilities, setCameraCapabilities] = useState(null);
  const [exposureMode, setExposureMode] = useState('continuous');
  
  // Line drawing state
  const [isDrawingLine, setIsDrawingLine] = useState(false);
  const [lineStart, setLineStart] = useState({ x: 0, y: 0 });
  const [lineEnd, setLineEnd] = useState({ x: 0, y: 0 });
  const [isLineDrawn, setIsLineDrawn] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractedData, setExtractedData] = useState(null);
  
  // Line adjustment state
  const [lineYOffset, setLineYOffset] = useState(0);
  const [lineRotation, setLineRotation] = useState(0);
  const [originalLineStart, setOriginalLineStart] = useState({ x: 0, y: 0 });
  const [originalLineEnd, setOriginalLineEnd] = useState({ x: 0, y: 0 });
  
  // Camera settings
  const [cameraResolution, setCameraResolution] = useState('640x480');
  const [cameraExposureTime, setCameraExposureTime] = useState(null); // Exposure time in milliseconds
  const [cameraBrightness, setCameraBrightness] = useState(null); // Brightness value
  const [cameraGain, setCameraGain] = useState(null);
  
  // Refs
  const cameraContainerRef = useRef(null);
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animationRequestRef = useRef(null);
  
  // Expose methods to parent component via ref
  useImperativeHandle(ref, () => ({
    // Get current camera settings
    getSettings: () => {
      return {
        cameraId: selectedCamera,
        resolution: cameraResolution,
        exposureTime: cameraExposureTime,
        brightness: cameraBrightness,
        gain: cameraGain,
        exposureMode: exposureMode,
        // Line drawing settings
        isLineDrawn: isLineDrawn,
        lineStart: originalLineStart,
        lineEnd: originalLineEnd,
        lineYOffset: lineYOffset,
        lineRotation: lineRotation
      };
    },
    
    // Expose startCamera method to parent
    startCamera: async () => {
      if (!isCameraActive && selectedCamera) {
        return startCamera();
      }
      return Promise.resolve(false);
    },
    
    // Apply saved camera settings
    applySettings: async (settings) => {
      if (!settings) return false;
      
      try {
        // Apply camera ID and start camera if needed
        if (settings.cameraId) {
          const cameraExists = availableCameras.some(camera => camera.deviceId === settings.cameraId);
          if (cameraExists) {
            setSelectedCamera(settings.cameraId);
            
            // If camera is not active, start it
            if (!isCameraActive) {
              // Short delay to allow state update
              setTimeout(() => startCamera(), 100);
              
              // Wait for camera to start before continuing
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          }
        }
        
        // Apply resolution
        if (settings.resolution) {
          setCameraResolution(settings.resolution);
        }
        
        // Apply exposure time
        if (settings.exposureTime !== null && settings.exposureTime !== undefined) {
          setCameraExposureTime(settings.exposureTime);
        }
        
        // Apply brightness
        if (settings.brightness !== null && settings.brightness !== undefined) {
          setCameraBrightness(settings.brightness);
        }
        
        // Apply gain
        if (settings.gain !== null && settings.gain !== undefined) {
          setCameraGain(settings.gain);
        }
        
        // Apply exposure mode
        if (settings.exposureMode) {
          setExposureMode(settings.exposureMode);
        }
        
        // Apply settings to camera
        await applyCameraSettings();
        
        // After camera settings are applied, handle line drawing settings
        if (settings.isLineDrawn && settings.lineStart && settings.lineEnd) {
          // Set original line points
          setOriginalLineStart(settings.lineStart);
          setOriginalLineEnd(settings.lineEnd);
          
          // Set current line points (will be adjusted by offset/rotation later)
          setLineStart(settings.lineStart);
          setLineEnd(settings.lineEnd);
          
          // Mark line as drawn
          setIsLineDrawn(true);
          
          // Apply line adjustments
          if (settings.lineYOffset !== undefined) {
            setLineYOffset(settings.lineYOffset);
          }
          
          if (settings.lineRotation !== undefined) {
            setLineRotation(settings.lineRotation);
          }
          
          // Calculate transformed line with adjustments
          calculateTransformedLinePosition();
          
          // Start extraction if needed
          setIsExtracting(true);
        }
        
        return true;
      } catch (error) {
        console.error('Error applying camera settings:', error);
        return false;
      }
    }
  }));
  
  // Get available cameras on component mount
  useEffect(() => {
    getAvailableCameras();
    
    // Cleanup function to stop video stream when component unmounts
    return () => {
      stopCamera();
    };
  }, []);
  
  // Initialize canvas size when video size changes
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current.width = cameraSize.width;
      canvasRef.current.height = cameraSize.height;
      
      // If line is drawn, redraw it when canvas size changes
      if (isLineDrawn) {
        drawLine();
      }
    }
  }, [cameraSize.width, cameraSize.height, isLineDrawn]);
  
  // Extract line data effect - runs continuously when line is drawn
  useEffect(() => {
    // Function to extract pixel data and process it
    const extractLineData = () => {
      if (isLineDrawn && videoRef.current && canvasRef.current && isCameraActive) {
        const transformedLine = calculateTransformedLinePosition();
        const lineData = getPixelsUnderLine(transformedLine.start, transformedLine.end);
        
        // Set extracted data state
        setExtractedData(lineData);
        
        // Send data to parent component if callback exists
        if (onLineDataChange) {
          onLineDataChange({
            start: transformedLine.start,
            end: transformedLine.end,
            yOffset: lineYOffset,
            rotation: lineRotation,
            pixelData: lineData
          });
        }
      }
      
      // Continue extraction loop if still extracting
      if (isExtracting) {
        animationRequestRef.current = requestAnimationFrame(extractLineData);
      }
    };
    
    // Start extraction if conditions are met
    if (isLineDrawn && isCameraActive && isExtracting) {
      animationRequestRef.current = requestAnimationFrame(extractLineData);
    }
    
    // Clean up animation frame on unmount or when dependencies change
    return () => {
      if (animationRequestRef.current) {
        cancelAnimationFrame(animationRequestRef.current);
        animationRequestRef.current = null;
      }
    };
  }, [isLineDrawn, isCameraActive, isExtracting, lineYOffset, lineRotation]);
  
  // Function to get available cameras
  const getAvailableCameras = async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        console.error('MediaDevices API is not supported in this browser');
        return;
      }
      
      // Request permission to camera first
      const tempStream = await navigator.mediaDevices.getUserMedia({ video: true });
      // Stop the temporary stream
      tempStream.getTracks().forEach(track => track.stop());
      
      // Now enumerate devices after getting permission
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(device => device.kind === 'videoinput');
      
      setAvailableCameras(videoDevices);
      
      // Select first camera by default if available
      if (videoDevices.length > 0) {
        setSelectedCamera(videoDevices[0].deviceId);
      }
    } catch (error) {
      console.error('Error accessing camera devices:', error);
    }
  };
  
  // Start camera stream
  const startCamera = async () => {
    try {
      if (!selectedCamera) return;
      
      // Stop any existing stream
      stopCamera();
      
      // Parse resolution
      const [width, height] = cameraResolution.split('x').map(Number);
      
      // Start new stream with selected camera and resolution
      const constraints = {
        video: { 
          deviceId: { exact: selectedCamera },
          width: { ideal: width },
          height: { ideal: height }
        }
      };
      
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Start playing the video
        await videoRef.current.play();
      }
      
      setIsCameraActive(true);
      
      // Get actual resolution from video track
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        const settings = videoTrack.getSettings();
        if (settings.width && settings.height) {
          setCameraSize({ width: settings.width, height: settings.height });
        }
        
        // Get camera capabilities
        const capabilities = videoTrack.getCapabilities();
        setCameraCapabilities(capabilities);
        console.log('Camera capabilities:', capabilities);
        console.log('Current camera settings:', settings);
        
        // Initialize settings based on capabilities
        if (capabilities.exposureTime) {
          // ExposureTime is in microseconds from the API, convert to milliseconds for UI
          const currentExposure = settings.exposureTime || Math.round((capabilities.exposureTime.max + capabilities.exposureTime.min) / 2);
          console.log('Current exposure time (μs):', currentExposure);
          setCameraExposureTime(currentExposure / 1000); // Convert from μs to ms for UI
          console.log('Set exposure time state (ms):', currentExposure / 1000);
          
          // Set current exposure mode
          if (settings.exposureMode) {
            setExposureMode(settings.exposureMode);
            console.log('Current exposure mode:', settings.exposureMode);
          }
        } else {
          setCameraExposureTime(null);
          console.log('Camera does not support exposureTime');
        }
        
        if (capabilities.brightness) {
          const defaultValue = settings.brightness || (capabilities.brightness.min + capabilities.brightness.max) / 2;
          setCameraBrightness(defaultValue);
        } else {
          setCameraBrightness(null);
        }
        
        if (capabilities.exposureCompensation) {
          const defaultValue = settings.exposureCompensation || (capabilities.exposureCompensation.min + capabilities.exposureCompensation.max) / 2;
          setCameraGain(defaultValue);
        } else {
          setCameraGain(null);
        }
      }
    } catch (error) {
      console.error('Error starting camera:', error);
      setIsCameraActive(false);
    }
  };
  
  // Stop camera stream
  const stopCamera = () => {
    if (streamRef.current) {
      const tracks = streamRef.current.getTracks();
      tracks.forEach(track => track.stop());
      streamRef.current = null;
    }
    
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    
    setIsCameraActive(false);
  };
  
  // Apply camera settings
  const applyCameraSettings = async () => {
    if (!isCameraActive || !streamRef.current) return;
    
    try {
      // Get current track
      const videoTrack = streamRef.current.getVideoTracks()[0];
      if (!videoTrack) return;
      
      // Get capabilities
      const capabilities = videoTrack.getCapabilities();
      
      // Create constraints in proper structure for browser compatibility
      const constraints = { advanced: [] };
      
      // Apply resolution if supported (this often requires stopping and restarting the stream)
      if (cameraResolution && isCameraActive) {
        const [width, height] = cameraResolution.split('x').map(Number);
        console.log('Applying resolution:', width, height);
        
        // For resolution changes, we'll stop and restart the camera with new constraints
        stopCamera();
        
        // Start a new stream with the new resolution
        const newConstraints = {
          video: { 
            deviceId: { exact: selectedCamera },
            width: { ideal: width },
            height: { ideal: height }
          }
        };
        
        // Short delay to ensure the previous stream is properly stopped
        setTimeout(async () => {
          try {
            const newStream = await navigator.mediaDevices.getUserMedia(newConstraints);
            streamRef.current = newStream;
            
            if (videoRef.current) {
              videoRef.current.srcObject = newStream;
              await videoRef.current.play();
            }
            
            // Get actual resolution and update state
            const newVideoTrack = newStream.getVideoTracks()[0];
            if (newVideoTrack) {
              const settings = newVideoTrack.getSettings();
              if (settings.width && settings.height) {
                setCameraSize({ width: settings.width, height: settings.height });
              }
              
              // After restart, apply the other settings as well
              applyNonResolutionSettings(newVideoTrack);
            }
          } catch (error) {
            console.error('Error restarting camera with new resolution:', error);
          }
        }, 100);
        
        return; // Exit early since we're restarting the camera
      }
      
      // If we're not changing resolution, apply other settings directly
      applyNonResolutionSettings(videoTrack);
      
    } catch (error) {
      console.error('Error applying camera settings:', error);
    }
  };
  
  // Handle exposure time change
  const handleExposureTimeChange = (e) => {
    if (!cameraCapabilities?.exposureTime) return;
    
    const value = parseFloat(e.target.value);
    const { step = 1 } = cameraCapabilities.exposureTime;
    
    // Ensure the value is divisible by the step size
    const roundedValue = Math.round(value / step) * step;
    // Round to 2 decimal places to avoid floating point issues
    const finalValue = parseFloat(roundedValue.toFixed(2));
    setCameraExposureTime(finalValue);
    
    // Set exposure mode to manual when user adjusts exposure time
    setExposureMode('manual');
    console.log('Changed exposure mode to manual because user adjusted exposure time');
  };
  
  // Handle brightness change
  const handleBrightnessChange = (e) => {
    if (!cameraCapabilities?.brightness) return;
    
    const value = parseFloat(e.target.value);
    const { step = 1 } = cameraCapabilities.brightness;
    
    // Ensure the value is divisible by the step size
    const roundedValue = Math.round(value / step) * step;
    // Round to 2 decimal places to avoid floating point issues
    const finalValue = parseFloat(roundedValue.toFixed(2));
    setCameraBrightness(finalValue);
  };
  
  // Handle gain change
  const handleGainChange = (e) => {
    if (!cameraCapabilities?.exposureCompensation) return;
    
    const value = parseFloat(e.target.value);
    const { step = 1 } = cameraCapabilities.exposureCompensation;
    
    // Ensure the value is divisible by the step size
    const roundedValue = Math.round(value / step) * step;
    // Round to 2 decimal places to avoid floating point issues
    const finalValue = parseFloat(roundedValue.toFixed(2));
    setCameraGain(finalValue);
  };
  
  // Helper function to apply non-resolution settings to a video track
  const applyNonResolutionSettings = async (videoTrack) => {
    if (!videoTrack) return;
    
    try {
      // Object to collect constraints
      const advancedConstraints = {};
      
      // Apply exposure time if available - ensure step size is respected
      if (cameraCapabilities?.exposureTime && cameraExposureTime !== null) {
        const { step = 1, min, max } = cameraCapabilities.exposureTime;
        
        // Convert from milliseconds (UI) to microseconds (API)
        const microseconds = cameraExposureTime * 1000; 
        
        // Ensure the value is within valid range and respects step size
        const adjustedValue = Math.max(min, Math.min(max, 
          Math.round(microseconds / step) * step));
        
        advancedConstraints.exposureTime = adjustedValue;
        console.log(`Attempting to set exposureTime: ${adjustedValue}μs (from ${cameraExposureTime}ms)`);
        
        // Set exposure mode to manual when applying exposure time
        if (exposureMode === 'manual' && cameraCapabilities.exposureMode?.includes('manual')) {
          advancedConstraints.exposureMode = 'manual';
          console.log('Setting exposure mode to manual');
        }
      }
      
      // Apply brightness if available - ensure step size is respected
      if (cameraCapabilities?.brightness && cameraBrightness !== null) {
        const { step = 1, min, max } = cameraCapabilities.brightness;
        // Ensure value is divisible by step size and within range
        const adjustedValue = Math.max(min, Math.min(max, 
          Math.round(cameraBrightness / step) * step));
        advancedConstraints.brightness = adjustedValue;
        console.log(`Attempting to set brightness: ${adjustedValue}`);
      }
      
      // Apply gain if available - ensure step size is respected
      if (cameraCapabilities?.exposureCompensation && cameraGain !== null) {
        const { step = 1, min, max } = cameraCapabilities.exposureCompensation;
        // Ensure value is divisible by step size and within range
        const adjustedValue = Math.max(min, Math.min(max, 
          Math.round(cameraGain / step) * step));
        advancedConstraints.exposureCompensation = adjustedValue;
        console.log(`Attempting to set exposureCompensation: ${adjustedValue}`);
      }
      
      // Log what we're trying to apply
      console.log('Applying camera constraints:', advancedConstraints);
      
      // Apply all constraints at once first (this is what most browsers prefer)
      try {
        const allConstraints = { advanced: [{ ...advancedConstraints }] };
        await videoTrack.applyConstraints(allConstraints);
        console.log('Successfully applied all constraints at once');
      } catch (err) {
        console.warn('Failed to apply all constraints at once, trying individually:', err);
        
        // Try applying constraints one by one as fallback
        for (const [constraint, value] of Object.entries(advancedConstraints)) {
          try {
            // Create a constraint object with just this property
            const singleConstraint = {};
            singleConstraint[constraint] = value;
            
            // Some browsers work better with the 'advanced' structure
            await videoTrack.applyConstraints({ advanced: [singleConstraint] });
            console.log(`Successfully applied ${constraint}:`, value);
          } catch (err) {
            // Try direct constraint as a last resort (for some older browsers)
            try {
              const directConstraint = {};
              directConstraint[constraint] = value;
              await videoTrack.applyConstraints(directConstraint);
              console.log(`Applied ${constraint} directly:`, value);
            } catch (directErr) {
              console.warn(`Failed to apply ${constraint}:`, directErr);
            }
          }
        }
      }
      
      // Get updated settings and log them
      const newSettings = videoTrack.getSettings();
      console.log('New camera settings:', newSettings);
      
      // Update our state based on actual applied settings
      if (newSettings.exposureTime !== undefined) {
        const newExposureMs = newSettings.exposureTime / 1000;
        console.log(`Updating exposureTime state to ${newExposureMs}ms (${newSettings.exposureTime}μs)`);
        setCameraExposureTime(newExposureMs);
      }
      
      if (newSettings.exposureMode !== undefined) {
        setExposureMode(newSettings.exposureMode);
        console.log(`Updating exposureMode to ${newSettings.exposureMode}`);
      }
      
      if (newSettings.brightness !== undefined) {
        setCameraBrightness(newSettings.brightness);
      }
      
      if (newSettings.exposureCompensation !== undefined) {
        setCameraGain(newSettings.exposureCompensation);
      }
      
    } catch (error) {
      console.error('Error applying non-resolution settings:', error);
    }
  };
  
  // Handle camera selection change
  const handleCameraChange = (e) => {
    const newCameraId = e.target.value;
    setSelectedCamera(newCameraId);
    
    // If camera is already active, restart with new camera
    if (isCameraActive) {
      stopCamera();
      // Small delay to ensure camera is properly stopped
      setTimeout(() => startCamera(), 100);
    }
  };
  
  // Reusable resize functionality adapted from parent component
  const handleResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Get initial coordinates and size
    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = cameraContainerRef.current?.offsetWidth || cameraSize.width;
    const startHeight = cameraContainerRef.current?.offsetHeight || cameraSize.height;
    
    // Show resize feedback
    setIsResizing(true);
    setShowResizeInfo(true);
    
    // Define move handler
    function handleMouseMove(moveEvent) {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      
      // Maintain aspect ratio (4:3)
      const aspectRatio = 4 / 3;
      let newWidth = Math.max(200, startWidth + deltaX);
      let newHeight = Math.max(150, newWidth / aspectRatio);
      
      // Update camera size
      const newSize = {
        width: Math.round(newWidth),
        height: Math.round(newHeight)
      };
      
      setCameraSize(newSize);
      
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
  
  // Start drawing a line on the video
  const startLineDrawing = (e) => {
    if (!isCameraActive) return;
    
    const rect = cameraContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Constrain to video bounds
    const boundedX = Math.max(0, Math.min(x, cameraSize.width));
    const boundedY = Math.max(0, Math.min(y, cameraSize.height));
    
    setLineStart({ x: boundedX, y: boundedY });
    setLineEnd({ x: boundedX, y: boundedY }); // Initially same point
    setIsDrawingLine(true);
  };
  
  // Update line end position while dragging
  const updateLineDrawing = (e) => {
    if (!isDrawingLine) return;
    
    const rect = cameraContainerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Constrain to video bounds
    const boundedX = Math.max(0, Math.min(x, cameraSize.width));
    const boundedY = Math.max(0, Math.min(y, cameraSize.height));
    
    setLineEnd({ x: boundedX, y: boundedY });
  };
  
  // Complete line drawing
  const finishLineDrawing = () => {
    if (!isDrawingLine) return;
    
    setIsDrawingLine(false);
    setIsLineDrawn(true);
    setIsExtracting(true); // Start extraction when line is drawn
    
    // Store original line positions for transformations
    setOriginalLineStart({ ...lineStart });
    setOriginalLineEnd({ ...lineEnd });
    
    // Reset transformation values
    setLineYOffset(0);
    setLineRotation(0);
    
    // Draw the line on the canvas
    drawLine();
    
    // Notify parent about line data
    if (onLineDataChange) {
      onLineDataChange({
        start: lineStart,
        end: lineEnd,
        yOffset: lineYOffset,
        rotation: lineRotation
      });
    }
  };
  
  // Clear the drawn line
  const clearLine = () => {
    setIsLineDrawn(false);
    setIsExtracting(false); // Stop extraction when line is cleared
    
    // Clear the canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    
    // Notify parent about line clearing
    if (onLineDataChange) {
      onLineDataChange(null);
    }
  };
  
  // Draw the line on the canvas with current transformations
  const drawLine = () => {
    const canvas = canvasRef.current;
    if (!canvas || !isLineDrawn) return;
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Calculate transformed line positions
    const transformedLine = calculateTransformedLinePosition();
    
    // Draw the line
    ctx.beginPath();
    ctx.moveTo(transformedLine.start.x, transformedLine.start.y);
    ctx.lineTo(transformedLine.end.x, transformedLine.end.y);
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 2;
    ctx.stroke();
    
    // Calculate and draw perpendicular indicator (small line in the middle perpendicular to main line)
    const midX = (transformedLine.start.x + transformedLine.end.x) / 2;
    const midY = (transformedLine.start.y + transformedLine.end.y) / 2;
    
    // Calculate the perpendicular direction
    const dx = transformedLine.end.x - transformedLine.start.x;
    const dy = transformedLine.end.y - transformedLine.start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length > 0) {
      // Normalize and rotate 90 degrees
      const perpX = -dy / length * 10; // 10px long
      const perpY = dx / length * 10;
      
      // Draw perpendicular line
      ctx.beginPath();
      ctx.moveTo(midX - perpX, midY - perpY);
      ctx.lineTo(midX + perpX, midY + perpY);
      ctx.strokeStyle = 'cyan';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  };
  
  // Calculate transformed line position based on sliders
  const calculateTransformedLinePosition = () => {
    if (!isLineDrawn) return { start: lineStart, end: lineEnd };
    
    // Calculate the line center
    const centerX = (originalLineStart.x + originalLineEnd.x) / 2;
    const centerY = (originalLineStart.y + originalLineEnd.y) / 2;
    
    // Convert rotation to radians
    const radians = (lineRotation * Math.PI) / 180;
    
    // Transform start point
    const startDX = originalLineStart.x - centerX;
    const startDY = originalLineStart.y - centerY;
    const rotatedStartX = centerX + startDX * Math.cos(radians) - startDY * Math.sin(radians);
    const rotatedStartY = centerY + startDX * Math.sin(radians) + startDY * Math.cos(radians) + lineYOffset;
    
    // Transform end point
    const endDX = originalLineEnd.x - centerX;
    const endDY = originalLineEnd.y - centerY;
    const rotatedEndX = centerX + endDX * Math.cos(radians) - endDY * Math.sin(radians);
    const rotatedEndY = centerY + endDX * Math.sin(radians) + endDY * Math.cos(radians) + lineYOffset;
    
    return {
      start: { x: rotatedStartX, y: rotatedStartY },
      end: { x: rotatedEndX, y: rotatedEndY }
    };
  };
  
  // Handle line Y-offset adjustment
  const handleLineYOffsetChange = (e) => {
    const newOffset = parseInt(e.target.value);
    setLineYOffset(newOffset);
    drawLine();
    
    // Notify parent about line data change
    if (onLineDataChange && isLineDrawn) {
      onLineDataChange({
        start: lineStart,
        end: lineEnd,
        yOffset: newOffset,
        rotation: lineRotation
      });
    }
  };
  
  // Handle line rotation adjustment
  const handleLineRotationChange = (e) => {
    const newRotation = parseInt(e.target.value);
    setLineRotation(newRotation);
    drawLine();
    
    // Notify parent about line data change
    if (onLineDataChange && isLineDrawn) {
      onLineDataChange({
        start: lineStart,
        end: lineEnd,
        yOffset: lineYOffset,
        rotation: newRotation
      });
    }
  };
  
  // Function to get pixels under the drawn line
  const getPixelsUnderLine = (start, end) => {
    if (!videoRef.current || !canvasRef.current) return null;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    
    // Draw the current video frame to the canvas (but don't display it)
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    
    // Calculate line points to sample
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const samples = Math.max(Math.ceil(distance), 1); // At least 1 sample
    
    // Initialize arrays for color data
    const redValues = [];
    const greenValues = [];
    const blueValues = [];
    const intensityValues = [];
    const positions = [];
    
    try {
      // Sample points along the line
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const x = Math.round(start.x + dx * t);
        const y = Math.round(start.y + dy * t);
        
        // Constrain to canvas boundaries
        const boundedX = Math.max(0, Math.min(x, canvas.width - 1));
        const boundedY = Math.max(0, Math.min(y, canvas.height - 1));
        
        // Get pixel data at this position
        const pixelData = ctx.getImageData(boundedX, boundedY, 1, 1).data;
        const [r, g, b] = pixelData;
        
        // Calculate intensity as simple float average (not weighted)
        const intensity = parseFloat((r + g + b) / 3);
        
        // Store values
        redValues.push(r);
        greenValues.push(g);
        blueValues.push(b);
        intensityValues.push(intensity);
        positions.push(i / samples); // Normalized position along line (0-1)
      }
      
      // Return structured data
      return {
        timestamp: Date.now(),
        positions,
        red: redValues,
        green: greenValues,
        blue: blueValues,
        intensity: intensityValues,
        lineLength: distance
      };
    } catch (error) {
      console.error('Error extracting pixel data:', error);
      return null;
    }
  };
  
  // Create a slider for a capability
  const renderCapabilitySlider = (capability, value, onChange, label, unit = '') => {
    if (!cameraCapabilities || !cameraCapabilities[capability] || value === null) {
      return null;
    }
    
    const capabilityInfo = cameraCapabilities[capability];
    // Ensure we get the step from capabilities or default to 1
    const { min, max, step = 1 } = capabilityInfo;
    
    // For exposure time, show the current mode
    const showModeIndicator = capability === 'exposureTime';
    
    // Use step attribute directly from capabilities
    return (
      <div style={styles.controlRow}>
        <label style={styles.controlLabel}>
          {label}:
          {showModeIndicator && (
            <span style={{
              fontSize: '9px',
              display: 'block',
              color: exposureMode === 'manual' ? '#ff9800' : '#4CAF50'
            }}>
              {exposureMode === 'manual' ? 'MANUAL' : 'AUTO'}
            </span>
          )}
        </label>
        <input 
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={onChange}
          style={{
            ...styles.slider,
            accentColor: exposureMode === 'manual' && capability === 'exposureTime' ? '#ff9800' : undefined
          }}
          disabled={!isCameraActive}
        />
        <span style={styles.value}>
          {typeof value === 'number' ? 
            step >= 1 ? value.toFixed(0) : value.toFixed(2) : value}
          {unit}
        </span>
        {showModeIndicator && cameraCapabilities.exposureMode?.includes('continuous') && (
          <button
            style={{
              ...buttonVariants.smallIconButton,
              padding: '2px 4px',
              fontSize: '10px',
              backgroundColor: exposureMode === 'manual' ? 'rgba(255, 152, 0, 0.5)' : 'rgba(76, 175, 80, 0.5)'
            }}
            onClick={() => {
              const newMode = exposureMode === 'manual' ? 'continuous' : 'manual';
              setExposureMode(newMode);
              console.log(`Toggled exposure mode to: ${newMode}`);
            }}
            title={`Click to switch to ${exposureMode === 'manual' ? 'auto' : 'manual'} exposure`}
          >
            {exposureMode === 'manual' ? 'AUTO' : 'MANUAL'}
          </button>
        )}
      </div>
    );
  };
  
  // Format capability value for display
  const formatCapabilityValue = (value) => {
    if (value === undefined || value === null) return 'N/A';
    
    if (typeof value === 'object') {
      if (value.min !== undefined && value.max !== undefined) {
        return `${value.min} to ${value.max}${value.step ? ` (step: ${value.step})` : ''}`;
      }
      return JSON.stringify(value);
    }
    
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    
    return value.toString();
  };
  
  // Render a table of camera capabilities
  const renderCapabilitiesTable = () => {
    if (!cameraCapabilities) {
      return <div>No capabilities information available</div>;
    }
    
    // Filter out common capabilities that are already exposed in the UI
    const commonCapabilities = ['width', 'height', 'deviceId', 'groupId'];
    const advancedCapabilities = Object.keys(cameraCapabilities)
      .filter(key => !commonCapabilities.includes(key))
      .sort();
    
    if (advancedCapabilities.length === 0) {
      return <div>No advanced capabilities exposed by this camera</div>;
    }
    
    return (
      <div style={styles.capabilitiesTable}>
        <h4 style={styles.capabilitiesTitle}>Camera Capabilities</h4>
        <div style={styles.scrollContainer}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Parameter</th>
                <th style={styles.th}>Supported Values</th>
              </tr>
            </thead>
            <tbody>
              {advancedCapabilities.map(key => (
                <tr key={key} style={styles.tr}>
                  <td style={styles.td}>{key}</td>
                  <td style={styles.td}>{formatCapabilityValue(cameraCapabilities[key])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };
  
  const styles = {
    container: {
      flex: '0 0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '5px',
      backgroundColor: 'rgba(0, 0, 0, 0.2)',
      padding: '10px',
      borderRadius: '4px',
      position: 'relative',
      border: isResizing ? '1px dashed #4CAF50' : 'none',
    },
    title: {
      margin: '0 0 10px 0',
      fontSize: '14px'
    },
    cameraSelect: {
      marginBottom: '10px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    selectLabel: {
      fontSize: '12px',
      minWidth: '60px'
    },
    select: {
      flex: 1,
      backgroundColor: 'rgba(30, 30, 30, 0.8)',
      color: 'white',
      border: '1px solid rgba(80, 80, 80, 0.5)',
      borderRadius: '3px',
      padding: '4px 8px',
      fontSize: '12px'
    },
    cameraView: {
      width: `${cameraSize.width}px`,
      height: `${cameraSize.height}px`,
      backgroundColor: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden'
    },
    video: {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      position: 'absolute',
      top: 0,
      left: 0
    },
    canvas: {
      position: 'absolute',
      top: 0,
      left: 0,
      pointerEvents: 'none', // Allow clicks to pass through to video
      zIndex: 10
    },
    buttonRow: {
      marginTop: '5px',
      display: 'flex',
      gap: '5px',
      flexWrap: 'wrap'
    },
    lineControls: {
      marginTop: '10px',
      padding: '8px',
      backgroundColor: 'rgba(0, 0, 0, 0.3)',
      borderRadius: '4px',
      display: isLineDrawn ? 'block' : 'none'
    },
    controlRow: {
      display: 'flex',
      alignItems: 'center',
      marginBottom: '8px',
      gap: '8px'
    },
    controlLabel: {
      fontSize: '12px',
      minWidth: '60px'
    },
    slider: {
      flex: 1
    },
    value: {
      fontSize: '12px',
      minWidth: '30px',
      textAlign: 'right'
    },
    settingsButton: {
      marginLeft: 'auto'
    },
    cameraSettings: {
      marginTop: '10px',
      padding: '8px',
      backgroundColor: 'rgba(0, 0, 0, 0.3)',
      borderRadius: '4px',
      display: showCameraSettings ? 'block' : 'none'
    },
    resizeHandle: {
      position: 'absolute',
      bottom: '0',
      right: '0',
      width: '20px',
      height: '20px',
      cursor: 'nwse-resize',
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
    capabilitiesTable: {
      marginTop: '10px',
      borderTop: '1px solid rgba(255, 255, 255, 0.1)',
      paddingTop: '10px'
    },
    capabilitiesTitle: {
      fontSize: '13px',
      margin: '0 0 8px 0'
    },
    scrollContainer: {
      maxHeight: '200px',
      overflowY: 'auto',
      backgroundColor: 'rgba(0, 0, 0, 0.2)',
      borderRadius: '3px'
    },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '11px'
    },
    th: {
      padding: '4px 8px',
      textAlign: 'left',
      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
      position: 'sticky',
      top: 0,
      backgroundColor: 'rgba(20, 20, 20, 0.8)'
    },
    tr: {
      borderBottom: '1px solid rgba(255, 255, 255, 0.05)'
    },
    td: {
      padding: '4px 8px',
      maxWidth: '200px',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap'
    },
    advancedToggle: {
      display: 'flex',
      alignItems: 'center',
      marginTop: '12px',
      padding: '6px 0',
      borderTop: '1px solid rgba(255, 255, 255, 0.1)',
      cursor: 'pointer',
      userSelect: 'none'
    },
    toggleIcon: {
      marginRight: '6px',
      transform: showAdvancedCapabilities ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.2s ease'
    }
  };
  
  return (
    <div style={styles.container}>
      <h3 style={styles.title}>Camera Feed</h3>
      
      {/* Camera selection */}
      <div style={styles.cameraSelect}>
        <label style={styles.selectLabel}>Camera:</label>
        <select 
          value={selectedCamera}
          onChange={handleCameraChange}
          style={styles.select}
          disabled={isCameraActive}
        >
          {availableCameras.length === 0 && (
            <option value="">No cameras found</option>
          )}
          {availableCameras.map(camera => (
            <option key={camera.deviceId} value={camera.deviceId}>
              {camera.label || `Camera ${camera.deviceId.slice(0, 5)}...`}
            </option>
          ))}
        </select>
      </div>
      
      {/* Camera view with line drawing capability */}
      <div 
        ref={cameraContainerRef}
        style={styles.cameraView}
        onMouseDown={isCameraActive ? startLineDrawing : undefined}
        onMouseMove={isCameraActive ? updateLineDrawing : undefined}
        onMouseUp={isCameraActive ? finishLineDrawing : undefined}
        onMouseLeave={isCameraActive ? finishLineDrawing : undefined}
      >
        {!isCameraActive && (
          <div>Camera feed will appear here</div>
        )}
        
        <video 
          ref={videoRef}
          style={{
            ...styles.video,
            display: isCameraActive ? 'block' : 'none'
          }}
          playsInline
          muted
        />
        
        <canvas 
          ref={canvasRef}
          style={{
            ...styles.canvas,
            display: isCameraActive ? 'block' : 'none'
          }}
          width={cameraSize.width}
          height={cameraSize.height}
        />
        
        {/* Resize info overlay */}
        {showResizeInfo && (
          <div style={styles.resizeInfo}>
            {cameraSize.width} × {cameraSize.height}
          </div>
        )}
        
        {/* Resize handle */}
        <div 
          style={styles.resizeHandle}
          onMouseDown={handleResizeStart}
          title="Resize camera view"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path 
              d="M9,3 L3,9 M11,5 L5,11 M11,8 L8,11" 
              stroke="white" 
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      </div>
      
      {/* Camera controls */}
      <div style={styles.buttonRow}>
        {!isCameraActive ? (
          <button 
            style={buttonVariants.smallPrimary}
            onClick={startCamera}
            disabled={!selectedCamera}
          >
            Start Camera
          </button>
        ) : (
          <button 
            style={buttonVariants.smallSecondary}
            onClick={stopCamera}
          >
            Stop Camera
          </button>
        )}
        
        {isCameraActive && (
          <>
            {isLineDrawn ? (
              <>
                <button 
                  style={buttonVariants.smallSecondary}
                  onClick={clearLine}
                >
                  Clear Line
                </button>
                <button 
                  style={{
                    ...buttonVariants.smallSecondary,
                    backgroundColor: isExtracting ? 'rgba(255, 0, 0, 0.5)' : undefined
                  }}
                  onClick={() => setIsExtracting(!isExtracting)}
                  title={isExtracting ? "Stop extracting data" : "Start extracting data"}
                >
                  {isExtracting ? "Stop Extract" : "Start Extract"}
                </button>
              </>
            ) : (
              <button 
                style={buttonVariants.smallSecondary}
                disabled={isDrawingLine}
                title="Click and drag on video to draw a line"
              >
                Draw Line
              </button>
            )}
            
            <button 
              style={{
                ...buttonVariants.smallSecondary,
                ...styles.settingsButton,
                backgroundColor: showCameraSettings ? 'rgba(0, 150, 150, 0.7)' : undefined
              }}
              onClick={() => setShowCameraSettings(!showCameraSettings)}
            >
              ⚙️ Camera Settings
            </button>
          </>
        )}
      </div>
      
      {/* Line adjustment controls */}
      {isLineDrawn && (
        <div style={styles.lineControls}>
          <div style={styles.controlRow}>
            <label style={styles.controlLabel}>Y Offset:</label>
            <input 
              type="range"
              min="-50"
              max="50"
              value={lineYOffset}
              onChange={handleLineYOffsetChange}
              style={styles.slider}
            />
            <span style={styles.value}>{lineYOffset}px</span>
          </div>
          
          <div style={styles.controlRow}>
            <label style={styles.controlLabel}>Rotation:</label>
            <input 
              type="range"
              min="-90"
              max="90"
              value={lineRotation}
              onChange={handleLineRotationChange}
              style={styles.slider}
            />
            <span style={styles.value}>{lineRotation}°</span>
          </div>
        </div>
      )}
      
      {/* Camera settings */}
      <div style={styles.cameraSettings}>
        <div style={styles.controlRow}>
          <label style={styles.controlLabel}>Resolution:</label>
          <select 
            value={cameraResolution}
            onChange={(e) => setCameraResolution(e.target.value)}
            style={styles.select}
            disabled={isCameraActive}
          >
            <option value="320x240">320x240</option>
            <option value="640x480">640x480</option>
            <option value="1280x720">1280x720 (HD)</option>
            <option value="1920x1080">1920x1080 (Full HD)</option>
          </select>
        </div>
        
        {/* Dynamic sliders based on camera capabilities */}
        {renderCapabilitySlider(
          'exposureTime', 
          cameraExposureTime, 
          handleExposureTimeChange, 
          'Exposure', 
          'ms'
        )}
        
        {renderCapabilitySlider(
          'brightness', 
          cameraBrightness, 
          handleBrightnessChange, 
          'Brightness'
        )}
        
        {renderCapabilitySlider(
          'exposureCompensation', 
          cameraGain, 
          handleGainChange, 
          'Gain'
        )}
        
        {/* Add a message if no adjustable settings are available */}
        {isCameraActive && 
         !cameraCapabilities?.exposureTime && 
         !cameraCapabilities?.brightness && 
         !cameraCapabilities?.exposureCompensation && (
          <div style={{ textAlign: 'center', padding: '10px', opacity: 0.7 }}>
            No adjustable camera parameters available
          </div>
        )}
        
        <button 
          style={{ ...buttonVariants.smallPrimary, width: '100%', marginTop: '8px' }}
          onClick={applyCameraSettings}
          disabled={!isCameraActive}
        >
          Apply Settings
        </button>
        
        {isCameraActive && cameraCapabilities && (
          <div 
            style={styles.advancedToggle}
            onClick={() => setShowAdvancedCapabilities(!showAdvancedCapabilities)}
          >
            <span style={styles.toggleIcon}>▶</span>
            <span>{showAdvancedCapabilities ? "Hide Camera Capabilities" : "Show Camera Capabilities"}</span>
          </div>
        )}
        
        {isCameraActive && showAdvancedCapabilities && renderCapabilitiesTable()}
      </div>
    </div>
  );
});

// Add display name for debugging
CameraComponent.displayName = 'CameraComponent';

export default CameraComponent; 