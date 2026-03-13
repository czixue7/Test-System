import React, { useEffect, useState } from 'react';

interface ModelDownloadModalProps {
  visible: boolean;
  onClose: () => void;
  onDownloadComplete?: () => void;
}

interface DownloadChannel {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  recommended?: boolean;
  url?: string;
  extractCode?: string;
}

const ModelDownloadModal: React.FC<ModelDownloadModalProps> = ({
  visible,
  onClose,
  onDownloadComplete
}) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setIsClosing(false);
      const timer = setTimeout(() => setModalVisible(true), 10);
      return () => clearTimeout(timer);
    } else {
      setIsClosing(true);
      const timer = setTimeout(() => setModalVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const downloadChannels: DownloadChannel[] = [
    {
      id: 'official',
      name: '官方下载',
      description: '推荐使用，速度稳定',
      recommended: true,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
        </svg>
      )
    },
    {
      id: 'github',
      name: 'GitHub镜像下载',
      description: '国内加速镜像',
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
          <path fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" clipRule="evenodd" />
        </svg>
      )
    },
    {
      id: 'baidu',
      name: '百度网盘下载',
      description: '提取码：ai2024',
      extractCode: 'ai2024',
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
        </svg>
      )
    }
  ];

  const handleDownload = () => {
    if (selectedChannel) {
      onDownloadComplete?.();
      onClose();
    }
  };

  if (!visible && !modalVisible) return null;

  return (
    <div 
      className={`fixed inset-0 bg-black flex items-center justify-center z-50 p-4 transition-all duration-300 ease-in-out ${isClosing ? 'bg-opacity-0' : 'bg-opacity-50'}`}
      onClick={onClose}
    >
      <div 
        className="bg-white dark:bg-gray-800 rounded-2xl p-5 w-full max-w-sm shadow-2xl transform transition-all duration-300 ease-in-out max-h-[90vh] overflow-y-auto"
        style={{
          transform: isClosing || !modalVisible ? 'scale(0)' : 'scale(1)',
          opacity: isClosing || !modalVisible ? 0 : 1
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-center mb-4">
          <div className="w-14 h-14 mx-auto mb-3 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center shadow-lg">
            <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-gray-800 dark:text-white mb-1">下载AI判题模型</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">AI判题功能需要下载离线模型，下载后可在无网络环境下使用</p>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 mb-4">
          <div className="flex items-center gap-2 text-sm text-blue-700 dark:text-blue-300">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>模型大小约 <strong>50MB</strong></span>
          </div>
        </div>

        <div className="mb-4">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">选择下载渠道</h3>
          <div className="space-y-2">
            {downloadChannels.map((channel) => (
              <div
                key={channel.id}
                onClick={() => setSelectedChannel(channel.id)}
                className={`flex items-center justify-between px-4 py-3 rounded-xl cursor-pointer transition-all border-2 ${
                  selectedChannel === channel.id
                    ? 'bg-blue-50 dark:bg-blue-900/30 border-blue-500 dark:border-blue-400'
                    : 'bg-gray-50 dark:bg-gray-700 border-transparent hover:bg-gray-100 dark:hover:bg-gray-600'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className={`${
                    selectedChannel === channel.id 
                      ? 'text-blue-600 dark:text-blue-400' 
                      : 'text-gray-500 dark:text-gray-400'
                  }`}>
                    {channel.icon}
                  </span>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={`font-medium text-sm ${
                        selectedChannel === channel.id 
                          ? 'text-blue-600 dark:text-blue-400' 
                          : 'text-gray-700 dark:text-gray-200'
                      }`}>
                        {channel.name}
                      </span>
                      {channel.recommended && (
                        <span className="px-1.5 py-0.5 text-xs bg-blue-500 text-white rounded-md">
                          推荐
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{channel.description}</p>
                  </div>
                </div>
                {selectedChannel === channel.id && (
                  <svg className="w-5 h-5 text-blue-500 dark:text-blue-400 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-3 mb-4">
          <div className="flex items-start gap-2 text-sm text-yellow-700 dark:text-yellow-300">
            <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="font-medium">注意事项</p>
              <p className="text-xs mt-1 text-yellow-600 dark:text-yellow-400">建议在WiFi环境下下载，确保网络稳定</p>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 px-4 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-all duration-200 active:scale-95"
          >
            稍后下载
          </button>
          <button
            onClick={handleDownload}
            disabled={!selectedChannel}
            className={`flex-1 py-2.5 px-4 rounded-xl font-medium transition-all duration-200 active:scale-95 ${
              selectedChannel
                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white hover:from-blue-600 hover:to-blue-700 shadow-md'
                : 'bg-gray-200 dark:bg-gray-600 text-gray-400 dark:text-gray-500 cursor-not-allowed'
            }`}
          >
            开始下载
          </button>
        </div>
      </div>
    </div>
  );
};

export default ModelDownloadModal;
