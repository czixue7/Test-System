import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useSafeArea } from '../hooks/useSafeArea';

interface ImageViewerProps {
  images: string[];
  onClose: () => void;
  initialIndex?: number;
  sourceRect?: DOMRect | null;
}

interface Transform {
  scale: number;
  translateX: number;
  translateY: number;
}

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

// 检测是否为安卓设备
const isAndroid = /Android/i.test(navigator.userAgent);

export const ImageViewer: React.FC<ImageViewerProps> = ({
  images,
  onClose,
  initialIndex = 0,
  sourceRect = null
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [transform, setTransform] = useState<Transform>({ scale: 1, translateX: 0, translateY: 0 });
  const [isDragging, setIsDragging] = useState(false);

  // 使用 ref 来存储动画状态，避免频繁渲染
  const animationRef = useRef<{
    startRect: DOMRect | null;
    isAnimating: boolean;
  }>({
    startRect: sourceRect,
    isAnimating: false
  });

  // 使用 ref 存储 transform，实现无延迟拖动
  const transformRef = useRef<Transform>({ scale: 1, translateX: 0, translateY: 0 });
  const imageElementRef = useRef<HTMLImageElement | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const swipeRef = useRef<HTMLDivElement>(null);
  const lastTouchRef = useRef<{ x: number; y: number } | null>(null);
  const lastDistanceRef = useRef<number>(0);
  const doubleTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  
  // 用于记录双指缩放时的中心点和上次缩放比例
  const pinchCenterRef = useRef<{ x: number; y: number } | null>(null);
  const lastScaleRef = useRef<number>(1);
  
  // 用于区分点击和拖动
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isPinchingRef = useRef<boolean>(false);
  
  const safeArea = useSafeArea();

  // 同步 ref 和 state
  useEffect(() => {
    transformRef.current = transform;
  }, [transform]);

  useEffect(() => {
    imageElementRef.current = imageRef.current;
  }, []);

  // 简化的日志函数 - 安卓减少日志
  const log = useCallback((message: string, data?: any) => {
    if (!isAndroid || message.includes('error') || message.includes('Close')) {
      console.log(`[ImageViewer] ${message}`, data ? JSON.stringify(data) : '');
    }
  }, []);

  // 关闭处理
  const handleClose = useCallback(() => {
    log('Closing viewer');
    setIsClosing(true);
    setIsVisible(false);
    setTransform({ scale: 1, translateX: 0, translateY: 0 });
    transformRef.current = { scale: 1, translateX: 0, translateY: 0 };

    setTimeout(() => {
      onClose();
    }, isAndroid ? 250 : 300); // 安卓使用更短的动画时间
  }, [sourceRect, onClose]);

  // 初始化动画 - 使用 CSS 类而不是内联样式变化
  useEffect(() => {
    log('Initializing animation', { hasSourceRect: !!sourceRect, isAndroid });
    animationRef.current.startRect = sourceRect;

    // 使用 setTimeout 确保 DOM 已经渲染
    const timer = setTimeout(() => {
      setIsVisible(true);
      log('Animation started');
    }, 50);

    return () => clearTimeout(timer);
  }, [sourceRect]);

  // 监听返回键（安卓系统导航返回）
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      // 如果图片查看器打开，关闭它而不是退出页面
      if (isVisible && !isClosing) {
        e.preventDefault();
        log('Back button pressed, closing image viewer');
        handleClose();
        // 阻止默认的返回行为
        window.history.pushState(null, '', window.location.href);
      }
    };

    // 添加历史记录，使返回键触发 popstate 事件
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [isVisible, isClosing, handleClose]);

  // 获取图片在容器中的实际位置和尺寸
  const getImageBounds = useCallback(() => {
    if (!imageRef.current || !containerRef.current) return null;

    const container = containerRef.current.getBoundingClientRect();
    const img = imageRef.current;

    // 计算图片实际显示区域（保持比例后的实际尺寸）
    const containerRatio = container.width / container.height;
    const imageRatio = img.naturalWidth / img.naturalHeight;

    let actualWidth = container.width;
    let actualHeight = container.height;

    if (imageRatio > containerRatio) {
      actualHeight = container.width / imageRatio;
    } else {
      actualWidth = container.height * imageRatio;
    }

    return {
      left: container.left + (container.width - actualWidth) / 2,
      top: container.top + (container.height - actualHeight) / 2,
      width: actualWidth,
      height: actualHeight,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight
    };
  }, []);

  // 直接更新图片 transform，无延迟 - 使用 translate3d 启用 GPU 加速
  const updateImageTransform = useCallback((newTransform: Transform) => {
    const img = imageElementRef.current;
    if (img && isVisible && !isClosing) {
      // 使用 translate3d 启用 GPU 硬件加速
      const x = newTransform.translateX;
      const y = newTransform.translateY;
      const scale = newTransform.scale;
      img.style.cssText = `
        position: fixed;
        left: 50%;
        top: 50%;
        width: 90vw;
        height: 90vh;
        object-fit: contain;
        transform: translate3d(calc(-50% + ${x}px), calc(-50% + ${y}px), 0) scale(${scale});
        will-change: transform;
        pointer-events: none;
      `;
    }
  }, [isVisible, isClosing]);

  // 处理双击
  const handleDoubleTap = useCallback((clientX: number, clientY: number) => {
    const bounds = getImageBounds();
    if (!bounds) return;

    let newTransform: Transform;
    if (transformRef.current.scale > 1.1) {
      // 缩小回原状
      newTransform = { scale: 1, translateX: 0, translateY: 0 };
    } else {
      // 从点击位置放大
      const clickX = clientX - bounds.left;
      const clickY = clientY - bounds.top;
      const scale = DOUBLE_TAP_SCALE;
      const translateX = (bounds.width / 2 - clickX) * (scale - 1);
      const translateY = (bounds.height / 2 - clickY) * (scale - 1);
      newTransform = { scale, translateX, translateY };
    }
    
    transformRef.current = newTransform;
    setTransform(newTransform);
    updateImageTransform(newTransform);
  }, [getImageBounds, updateImageTransform]);

  // 触摸开始
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // 不要禁用默认行为，让按钮可以正常点击
    
    if (e.touches.length === 1) {
      touchStartRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY,
        time: Date.now()
      };
      lastTouchRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      };
      
      // 检测双击
      if (doubleTapRef.current && Date.now() - doubleTapRef.current.time < 300) {
        handleDoubleTap(e.touches[0].clientX, e.touches[0].clientY);
        doubleTapRef.current = null;
        return;
      }
      doubleTapRef.current = { time: Date.now(), x: e.touches[0].clientX, y: e.touches[0].clientY };
      
      if (transformRef.current.scale > 1) {
        setIsDragging(true);
      }
    } else if (e.touches.length === 2) {
      // 双指缩放开始
      isPinchingRef.current = true;
      setIsDragging(false);
      
      const distance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      lastDistanceRef.current = distance;
      lastScaleRef.current = transformRef.current.scale;
      
      // 计算双指中心点
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const centerX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const centerY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        pinchCenterRef.current = {
          x: centerX - rect.left - rect.width / 2,
          y: centerY - rect.top - rect.height / 2
        };
      }
    }
  }, [handleDoubleTap]);

  // 触摸移动 - 直接操作 DOM，无延迟
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    // 双指缩放时禁用默认行为
    if (e.touches.length === 2) {
      e.preventDefault();
    }

    if (e.touches.length === 1 && isDragging && lastTouchRef.current && !isPinchingRef.current) {
      const deltaX = e.touches[0].clientX - lastTouchRef.current.x;
      const deltaY = e.touches[0].clientY - lastTouchRef.current.y;

      const newTransform = {
        ...transformRef.current,
        translateX: transformRef.current.translateX + deltaX,
        translateY: transformRef.current.translateY + deltaY
      };

      // 直接更新 DOM，无 React 延迟
      transformRef.current = newTransform;
      updateImageTransform(newTransform);

      // 同步更新 state（用于后续渲染）
      setTransform(newTransform);

      lastTouchRef.current = {
        x: e.touches[0].clientX,
        y: e.touches[0].clientY
      };
    } else if (e.touches.length === 2) {
      e.preventDefault();
      
      const distance = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );

      if (lastDistanceRef.current > 0 && pinchCenterRef.current) {
        // 计算相对于初始触摸点的缩放比例
        const scaleDelta = distance / lastDistanceRef.current;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, lastScaleRef.current * scaleDelta));
        
        // 以双指中心为基准进行缩放
        const center = pinchCenterRef.current;
        // 使用当前缩放比例计算新的偏移
        const currentScale = transformRef.current.scale;
        const scaleRatio = newScale / currentScale;
        const newTranslateX = center.x - (center.x - transformRef.current.translateX) * scaleRatio;
        const newTranslateY = center.y - (center.y - transformRef.current.translateY) * scaleRatio;
        
        const newTransform = {
          scale: newScale,
          translateX: newTranslateX,
          translateY: newTranslateY
        };
        
        transformRef.current = newTransform;
        setTransform(newTransform);
        updateImageTransform(newTransform);
      }
    }
  }, [isDragging, updateImageTransform]);

  // 触摸结束
  const handleTouchEnd = useCallback(() => {
    // 延迟重置，避免和点击冲突
    setTimeout(() => {
      isPinchingRef.current = false;
    }, 100);
    
    setIsDragging(false);
    lastTouchRef.current = null;
    lastDistanceRef.current = 0;
    pinchCenterRef.current = null;
    lastScaleRef.current = transformRef.current.scale;

    if (transformRef.current.scale < 1) {
      const newTransform = { scale: 1, translateX: 0, translateY: 0 };
      transformRef.current = newTransform;
      setTransform(newTransform);
      updateImageTransform(newTransform);
    }
  }, [updateImageTransform]);

  // 鼠标事件处理（桌面端）- 直接操作 DOM，无延迟
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 禁用默认拖动行为
    e.preventDefault();
    
    if (transformRef.current.scale > 1) {
      setIsDragging(true);
      lastTouchRef.current = { x: e.clientX, y: e.clientY };
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // 禁用默认行为
    e.preventDefault();
    
    if (isDragging && lastTouchRef.current) {
      const deltaX = e.clientX - lastTouchRef.current.x;
      const deltaY = e.clientY - lastTouchRef.current.y;

      const newTransform = {
        ...transformRef.current,
        translateX: transformRef.current.translateX + deltaX,
        translateY: transformRef.current.translateY + deltaY
      };

      // 直接更新 DOM，无 React 延迟
      transformRef.current = newTransform;
      updateImageTransform(newTransform);

      // 同步更新 state
      setTransform(newTransform);

      lastTouchRef.current = { x: e.clientX, y: e.clientY };
    }
  }, [isDragging, updateImageTransform]);

  const handleMouseUp = useCallback((e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    setIsDragging(false);
    lastTouchRef.current = null;
  }, []);

  // 滚轮缩放 - 以鼠标位置为中心
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    // 鼠标相对于容器中心的位置
    const mouseX = e.clientX - rect.left - rect.width / 2;
    const mouseY = e.clientY - rect.top - rect.height / 2;
    
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const oldScale = transformRef.current.scale;
    const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, oldScale * delta));
    
    // 计算新的偏移，使缩放以鼠标位置为中心
    // 公式: newTranslate = mousePos - (mousePos - oldTranslate) * (newScale / oldScale)
    const scaleRatio = newScale / oldScale;
    const newTranslateX = mouseX - (mouseX - transformRef.current.translateX) * scaleRatio;
    const newTranslateY = mouseY - (mouseY - transformRef.current.translateY) * scaleRatio;
    
    const newTransform = {
      scale: newScale,
      translateX: newTranslateX,
      translateY: newTranslateY
    };
    
    transformRef.current = newTransform;
    setTransform(newTransform);
    updateImageTransform(newTransform);
  }, [updateImageTransform]);

  const currentImage = images[currentIndex];

  // 计算动画样式
  const getAnimationStyles = (): React.CSSProperties => {
    const startRect = animationRef.current.startRect;

    if (!startRect) {
      // 没有源位置，使用简单的淡入淡出
      return {
        opacity: isVisible ? 1 : 0,
        transition: isAndroid ? 'opacity 0.2s ease' : 'opacity 0.3s ease',
      };
    }

    if (isClosing) {
      // 关闭时 - 缩回原位置
      return {
        position: 'fixed',
        left: startRect.left,
        top: startRect.top,
        width: startRect.width,
        height: startRect.height,
        objectFit: 'contain',
        opacity: isVisible ? 1 : 0,
        transition: isAndroid
          ? 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
          : 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        willChange: 'transform, opacity',
      };
    }

    if (!isVisible) {
      // 初始状态 - 在原位置
      return {
        position: 'fixed',
        left: startRect.left,
        top: startRect.top,
        width: startRect.width,
        height: startRect.height,
        objectFit: 'contain',
        opacity: 0,
      };
    }

    // 打开后 - 居中显示
    return {
      position: 'fixed',
      left: '50%',
      top: '50%',
      width: '90vw',
      height: '90vh',
      objectFit: 'contain',
      opacity: 1,
      transition: isAndroid
        ? 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
        : 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      willChange: 'transform, opacity',
    };
  };

  const animationStyle = getAnimationStyles();

  // 计算图片变换样式 - 只在非拖动状态下使用
  const imageTransformStyle: React.CSSProperties = isClosing || !isVisible
    ? animationStyle
    : {
        ...animationStyle,
        transform: `translate3d(calc(-50% + ${transform.translateX}px), calc(-50% + ${transform.translateY}px), 0) scale(${transform.scale})`,
        cursor: isDragging ? 'grabbing' : transform.scale > 1 ? 'grab' : 'default',
        willChange: 'transform',
        pointerEvents: 'none' as const,
      };

  return (
    <div
      ref={containerRef}
      className={`fixed inset-0 z-[100] flex items-center justify-center ${
        isVisible ? 'bg-black/90' : 'bg-black/0'
      }`}
      style={{
        transition: isAndroid ? 'background-color 0.25s ease' : 'background-color 0.3s ease',
        willChange: 'background-color',
        touchAction: 'none', // 禁用浏览器触摸行为
        userSelect: 'none', // 禁用选择
        WebkitUserSelect: 'none',
      }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onContextMenu={(e) => e.preventDefault()} // 禁用右键菜单
    >
      {/* 图片 - 使用单独的包装器来处理动画 */}
      <div
        className="relative flex items-center justify-center"
        style={{
          width: isVisible && !isClosing ? '90vw' : undefined,
          height: isVisible && !isClosing ? '90vh' : undefined,
          touchAction: 'none',
        }}
      >
        <img
          ref={imageRef}
          src={currentImage}
          alt=""
          style={imageTransformStyle}
          className={`${isClosing || !isVisible ? 'opacity-0' : 'opacity-100'} select-none`}
          onClick={(e) => e.stopPropagation()}
          draggable={false}
          onDragStart={(e) => e.preventDefault()} // 禁用拖动
        />
      </div>

      {/* 控制按钮容器 - 使用 pointer-events-auto 确保按钮可点击 */}
      <div
        ref={swipeRef}
        className={`absolute inset-0 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
        style={{
          transition: isAndroid ? 'opacity 0.2s ease' : 'opacity 0.3s ease',
          touchAction: 'none',
          pointerEvents: 'none', // 默认不拦截触摸事件
        }}
      >
        {/* 关闭按钮 - 明确启用 pointer events */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            log('Close button clicked');
            handleClose();
          }}
          className={`fixed right-4 z-[110] w-10 h-10 bg-white/20 active:bg-white/40 rounded-full flex items-center justify-center text-white ${
            isVisible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{
            top: `${safeArea.top + 16}px`,
            touchAction: 'manipulation',
            pointerEvents: 'auto', // 确保按钮可点击
            transition: isAndroid ? 'opacity 0.2s ease, background-color 0.15s' : 'opacity 0.3s ease, background-color 0.2s',
          }}
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* 图片计数器 */}
        {images.length > 1 && (
          <div
            className={`fixed left-4 z-[110] px-3 py-1 bg-white/20 rounded-full text-white text-sm ${
              isVisible ? 'opacity-100' : 'opacity-0'
            }`}
            style={{
              top: `${safeArea.top + 16}px`,
              pointerEvents: 'auto',
              transition: isAndroid ? 'opacity 0.2s ease' : 'opacity 0.3s ease',
            }}
          >
            {currentIndex + 1} / {images.length}
          </div>
        )}

        {/* 缩放提示 */}
        {transform.scale > 1 && (
          <div 
            className="fixed bottom-8 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/50 rounded-full text-white text-xs"
            style={{ pointerEvents: 'auto' }}
          >
            {transform.scale.toFixed(1)}x
          </div>
        )}

        {/* 左右切换按钮 */}
        {images.length > 1 && transform.scale === 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(Math.max(0, currentIndex - 1));
                const newTransform = { scale: 1, translateX: 0, translateY: 0 };
                transformRef.current = newTransform;
                setTransform(newTransform);
              }}
              disabled={currentIndex === 0}
              className={`absolute left-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/20 active:bg-white/40 disabled:opacity-30 rounded-full flex items-center justify-center text-white ${
                isVisible ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ 
                pointerEvents: 'auto',
                transition: isAndroid ? 'opacity 0.2s ease' : 'opacity 0.3s ease' 
              }}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCurrentIndex(Math.min(images.length - 1, currentIndex + 1));
                const newTransform = { scale: 1, translateX: 0, translateY: 0 };
                transformRef.current = newTransform;
                setTransform(newTransform);
              }}
              disabled={currentIndex === images.length - 1}
              className={`absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 bg-white/20 active:bg-white/40 disabled:opacity-30 rounded-full flex items-center justify-center text-white ${
                isVisible ? 'opacity-100' : 'opacity-0'
              }`}
              style={{ 
                pointerEvents: 'auto',
                transition: isAndroid ? 'opacity 0.2s ease' : 'opacity 0.3s ease' 
              }}
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </>
        )}

        {/* 操作提示 */}
        <div 
          className="fixed bottom-4 left-1/2 -translate-x-1/2 text-white/50 text-xs text-center"
          style={{ pointerEvents: 'auto' }}
        >
          双击放大 · 拖动移动
        </div>
      </div>
    </div>
  );
};

export default ImageViewer;
