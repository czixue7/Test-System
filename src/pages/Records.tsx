import React from 'react';
import { Link } from 'react-router-dom';
import { useRecordStore } from '../store/recordStore';

const Records: React.FC = () => {
  const { records, deleteRecord, clearRecords } = useRecordStore();

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}分${secs}秒`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getScoreColor = (percentage: number) => {
    if (percentage >= 80) return 'text-green-500';
    if (percentage >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <div className="page-container">
      <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4 sm:mb-6">
          <div className="flex items-center gap-2 sm:gap-4">
            <Link to="/" className="btn-back">
              <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              返回首页
            </Link>
            <h1 className="title-primary">测试记录</h1>
          </div>
          {records.length > 0 && (
            <button
              onClick={() => {
                if (confirm('确定要清空所有记录吗？')) {
                  clearRecords();
                }
              }}
              className="px-3 py-1.5 sm:px-4 sm:py-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors text-sm sm:text-base"
            >
              清空记录
            </button>
          )}
        </div>

        {records.length === 0 ? (
          <div className="card text-center py-8 sm:py-12">
            <svg className="w-12 h-12 sm:w-16 sm:h-16 mx-auto text-gray-300 mb-3 sm:mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-gray-500 mb-3 sm:mb-4 text-sm sm:text-base">暂无测试记录</p>
            <Link to="/" className="btn-primary inline-block">去测试</Link>
          </div>
        ) : (
          <div className="space-y-3 sm:space-y-4">
            {records.map((record) => (
              <div key={record.id} className="card">
                <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base sm:text-lg font-semibold text-gray-800 mb-1">{record.bankName}</h3>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-4 text-xs sm:text-sm text-gray-500 mb-2">
                      <span>{formatDate(record.finishedAt)}</span>
                      <span>用时: {formatDuration(record.duration)}</span>
                      <span>题数: {record.answers.length}</span>
                    </div>
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className={`text-xl sm:text-2xl font-bold ${getScoreColor(record.percentage)}`}>
                        {record.totalScore} / {record.maxScore}
                      </div>
                      <div className={`text-base sm:text-lg font-medium ${getScoreColor(record.percentage)}`}>
                        {record.percentage}%
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Link
                      to={`/result/${record.id}`}
                      className="flex-1 sm:flex-initial px-3 py-1.5 sm:px-4 sm:py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-center text-sm sm:text-base"
                    >
                      查看详情
                    </Link>
                    <button
                      onClick={() => {
                        if (confirm('确定要删除这条记录吗？')) {
                          deleteRecord(record.id);
                        }
                      }}
                      className="px-2 py-1.5 sm:px-3 sm:py-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                    >
                      <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Records;
