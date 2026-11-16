import React, { useEffect, useState } from 'react';
import Modal from './Modal';
import AboutAppCard from './AboutAppCard';
import AboutUpdatePanel from './AboutUpdatePanel';
import { CURRENT_VERSION_HASH } from '../utils/updater';
import { useUpdaterStore } from '../store/updaterStore';

interface AboutDialogProps {
  open: boolean;
  onClose: () => void;
  /** 打开时直接展开更新区域（启动自动检测到新版本时使用） */
  autoExpand?: boolean;
}

const currentVersion = '0.4.4';

/**
 * 「关于」弹窗：展示版本信息与更新面板。
 * 我的页面手动打开与启动时自动检测到更新共用同一个弹窗。
 */
const AboutDialog: React.FC<AboutDialogProps> = ({ open, onClose, autoExpand = false }) => {
  const [panelStarted, setPanelStarted] = useState(false);
  const updateActive = useUpdaterStore(state => state.checkingUpdate || state.downloadStatus !== 'idle');

  useEffect(() => {
    if (open) setPanelStarted(false);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} className="about-dialog w-full max-w-sm" containerClassName="about-overlay">
      <div className="about-body text-center">
        <AboutAppCard version={currentVersion} build={CURRENT_VERSION_HASH} compact={panelStarted || autoExpand || updateActive} />
        <AboutUpdatePanel expanded={panelStarted || autoExpand || updateActive} onExpand={() => setPanelStarted(true)} />
      </div>
      <div className="about-actions">
        <button type="button" onClick={onClose} className="w-full py-2.5 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-lg font-medium hover:from-blue-600 hover:to-blue-700 transition-colors">确定</button>
      </div>
    </Modal>
  );
};

export default AboutDialog;
