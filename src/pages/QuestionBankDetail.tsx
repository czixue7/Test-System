import React, { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuestionBankStore } from '../store/questionBankStore';
import { Question, QuestionType, AnswerWithImages } from '../types';
import { isBuiltInBank } from '../utils/builtInBanks';

function isAnswerWithImages(answer: unknown): answer is AnswerWithImages {
  return typeof answer === 'object' && answer !== null && 'text' in answer;
}

function getAnswerText(correctAnswer: string | string[] | AnswerWithImages): string {
  if (isAnswerWithImages(correctAnswer)) {
    return correctAnswer.text;
  }
  if (Array.isArray(correctAnswer)) {
    return correctAnswer.join(', ');
  }
  return String(correctAnswer);
}

const QuestionBankDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getBank, updateBank, addQuestion, updateQuestion, deleteQuestion } = useQuestionBankStore();
  const bank = getBank(id!);
  
  const [isEditMode, setIsEditMode] = useState(false);
  const [bankForm, setBankForm] = useState({ name: '', description: '' });
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [expandedQuestions, setExpandedQuestions] = useState<Set<string>>(new Set());
  const [questionForm, setQuestionForm] = useState<{
    type: QuestionType;
    content: string;
    options: { id: string; content: string }[];
    correctAnswer: string | string[] | AnswerWithImages;
    score: number;
    explanation: string;
    allowDisorder: boolean;
  }>({
    type: 'single-choice',
    content: '',
    options: [
      { id: 'A', content: '' },
      { id: 'B', content: '' },
      { id: 'C', content: '' },
      { id: 'D', content: '' }
    ],
    correctAnswer: '',
    score: 10,
    explanation: '',
    allowDisorder: false
  });

  if (!bank) {
    return (
      <div className="page-container">
        <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
          <div className="card text-center py-12">
            <p className="text-gray-500">题库不存在</p>
            <Link to="/" className="btn-primary mt-4 inline-block">返回首页</Link>
          </div>
        </div>
      </div>
    );
  }

  const resetForm = () => {
    setQuestionForm({
      type: 'single-choice',
      content: '',
      options: [
        { id: 'A', content: '' },
        { id: 'B', content: '' },
        { id: 'C', content: '' },
        { id: 'D', content: '' }
      ],
      correctAnswer: '',
      score: 10,
      explanation: '',
      allowDisorder: false
    });
    setEditingQuestionId(null);
  };

  const handleSaveBank = () => {
    if (!bankForm.name.trim()) {
      alert('请输入题库名称');
      return;
    }
    updateBank(bank.id, {
      name: bankForm.name.trim(),
      description: bankForm.description.trim() || undefined
    });
    setIsEditMode(false);
  };

  const handleEnterEditMode = () => {
    setBankForm({ name: bank.name, description: bank.description || '' });
    setIsEditMode(true);
  };

  const handleSaveQuestion = () => {
    if (!questionForm.content.trim()) {
      alert('请输入题目内容');
      return;
    }

    if (questionForm.type === 'single-choice' || questionForm.type === 'multiple-choice') {
      const validOptions = questionForm.options.filter(o => o.content.trim());
      if (validOptions.length < 2) {
        alert('选择题至少需要2个有效选项');
        return;
      }
    }

    if (!questionForm.correctAnswer || (Array.isArray(questionForm.correctAnswer) && questionForm.correctAnswer.length === 0)) {
      alert('请设置正确答案');
      return;
    }

    const questionData: Omit<Question, 'id'> = {
      type: questionForm.type,
      content: questionForm.content.trim(),
      options: questionForm.type === 'single-choice' || questionForm.type === 'multiple-choice'
        ? questionForm.options.filter(o => o.content.trim())
        : undefined,
      correctAnswer: questionForm.correctAnswer,
      score: questionForm.score,
      explanation: questionForm.explanation.trim() || undefined,
      allowDisorder: questionForm.type === 'fill-in-blank' ? questionForm.allowDisorder : undefined
    };

    if (editingQuestionId) {
      updateQuestion(bank.id, editingQuestionId, questionData);
    } else {
      addQuestion(bank.id, questionData);
    }

    resetForm();
  };

  const handleEditQuestion = (question: Question) => {
    setEditingQuestionId(question.id);
    setQuestionForm({
      type: question.type,
      content: question.content,
      options: question.options || [
        { id: 'A', content: '' },
        { id: 'B', content: '' },
        { id: 'C', content: '' },
        { id: 'D', content: '' }
      ],
      correctAnswer: question.correctAnswer,
      score: question.score,
      explanation: question.explanation || '',
      allowDisorder: question.allowDisorder || false
    });
    setExpandedQuestions(prev => new Set(prev).add(question.id));
  };

  const handleDeleteQuestion = (questionId: string) => {
    if (confirm('确定要删除这道题目吗？')) {
      deleteQuestion(bank.id, questionId);
      if (editingQuestionId === questionId) {
        resetForm();
      }
    }
  };

  const toggleExpand = (questionId: string) => {
    setExpandedQuestions(prev => {
      const newSet = new Set(prev);
      if (newSet.has(questionId)) {
        newSet.delete(questionId);
      } else {
        newSet.add(questionId);
      }
      return newSet;
    });
  };

  const getQuestionTypeLabel = (type: QuestionType) => {
    const labels: Record<QuestionType, string> = {
      'fill-in-blank': '填空题',
      'single-choice': '单选题',
      'multiple-choice': '多选题',
      'subjective': '主观题'
    };
    return labels[type];
  };

  const isBuiltIn = isBuiltInBank(bank.id);
  const isEditing = editingQuestionId !== null;

  return (
    <div className="page-container">
      <div className="w-full max-w-4xl mx-auto box-border px-1 sm:px-0">
        <div className="mb-3 sm:mb-4">
          <Link to="/" className="btn-back">
            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            返回题库列表
          </Link>
        </div>

        <div className="flex flex-col sm:flex-row justify-between items-start gap-3 sm:gap-4 mb-3 sm:mb-4">
          {isEditMode ? (
            <div className="flex-1 w-full sm:mr-4">
              <input
                type="text"
                value={bankForm.name}
                onChange={(e) => setBankForm(prev => ({ ...prev, name: e.target.value }))}
                className="w-full text-lg sm:text-xl md:text-2xl font-bold text-gray-800 border-b-2 border-blue-500 focus:outline-none bg-transparent pb-1"
                placeholder="题库名称"
              />
              <textarea
                value={bankForm.description}
                onChange={(e) => setBankForm(prev => ({ ...prev, description: e.target.value }))}
                className="w-full text-gray-500 mt-1 border border-gray-200 rounded-lg p-2 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm sm:text-base"
                placeholder="题库描述（可选）"
                rows={2}
              />
            </div>
          ) : (
            <div className="mr-0 sm:mr-4">
              <h1 className="title-primary">{bank.name}</h1>
              {bank.description && (
                <p className="text-gray-500 mt-1 text-sm sm:text-base">{bank.description}</p>
              )}
            </div>
          )}
          <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto">
            {isEditMode ? (
              <>
                <button
                  onClick={() => setIsEditMode(false)}
                  className="btn-secondary flex-1 sm:flex-initial"
                >
                  取消
                </button>
                <button
                  onClick={handleSaveBank}
                  className="btn-primary flex-1 sm:flex-initial"
                >
                  保存
                </button>
              </>
            ) : (
              <>
                {!isBuiltIn && (
                  <button
                    onClick={handleEnterEditMode}
                    className="btn-secondary flex-1 sm:flex-initial"
                  >
                    编辑题库
                  </button>
                )}
                {bank.questions.length > 0 && (
                  <button
                    onClick={() => navigate(`/exam/${bank.id}`)}
                    className="flex-1 sm:flex-initial px-3 py-1.5 sm:px-4 sm:py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors text-sm sm:text-base"
                  >
                    开始测试
                  </button>
                )}
                {!isBuiltIn && (
                  <button
                    onClick={() => {
                      resetForm();
                      setEditingQuestionId('new');
                    }}
                    className="btn-primary flex-1 sm:flex-initial"
                  >
                    添加题目
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {isEditing && editingQuestionId === 'new' && (
          <div className="card mb-3 sm:mb-4 border-2 border-blue-200 bg-blue-50">
            <div className="flex justify-between items-center mb-2 sm:mb-3">
              <h3 className="font-semibold text-gray-800 text-sm sm:text-base">添加新题目</h3>
              <button
                onClick={resetForm}
                className="text-gray-500 hover:text-gray-700"
              >
                <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <QuestionForm
              form={questionForm}
              setForm={setQuestionForm}
              onSave={handleSaveQuestion}
              onCancel={resetForm}
              isEditing={false}
            />
          </div>
        )}

        {bank.questions.length === 0 && !isEditing ? (
          <div className="card text-center py-6 sm:py-8">
            <svg className="w-10 h-10 sm:w-12 sm:h-12 mx-auto text-gray-300 mb-2 sm:mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-gray-500 mb-2 sm:mb-3 text-sm sm:text-base">暂无题目，点击上方按钮添加</p>
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {bank.questions.map((question, index) => {
              const isExpanded = expandedQuestions.has(question.id);
              const isThisEditing = editingQuestionId === question.id;
              
              return (
                <div 
                  key={question.id} 
                  className={`card transition-all ${isThisEditing ? 'border-2 border-blue-500 bg-blue-50' : ''}`}
                >
                  <div 
                    className="flex justify-between items-center cursor-pointer"
                    onClick={() => !isThisEditing && toggleExpand(question.id)}
                  >
                    <div className="flex items-center gap-1.5 sm:gap-2 flex-1 min-w-0">
                      <span className="badge badge-info flex-shrink-0">{index + 1}</span>
                      <span className="badge badge-success flex-shrink-0">{getQuestionTypeLabel(question.type)}</span>
                      <span className="text-xs sm:text-sm text-gray-500 flex-shrink-0">{question.score}分</span>
                      <span className={`text-gray-800 ml-1 sm:ml-2 text-sm sm:text-base ${isExpanded ? 'whitespace-pre-wrap' : 'truncate'}`}>{question.content}</span>
                    </div>
                    <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0 ml-2">
                      {!isThisEditing && (
                        <>
                          {isEditMode && (
                            <>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditQuestion(question);
                                }}
                                className="px-1.5 py-0.5 sm:px-2 sm:py-1 text-xs sm:text-sm text-blue-500 hover:bg-blue-100 rounded transition-colors"
                              >
                                编辑
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteQuestion(question.id);
                                }}
                                className="px-1.5 py-0.5 sm:px-2 sm:py-1 text-xs sm:text-sm text-red-500 hover:bg-red-100 rounded transition-colors"
                              >
                                删除
                              </button>
                            </>
                          )}
                          <svg 
                            className={`w-4 h-4 sm:w-5 sm:h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} 
                            fill="none" 
                            stroke="currentColor" 
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {isThisEditing ? (
                    <div className="mt-3 sm:mt-4 pt-3 sm:pt-4 border-t border-blue-200">
                      <QuestionForm
                        form={questionForm}
                        setForm={setQuestionForm}
                        onSave={handleSaveQuestion}
                        onCancel={resetForm}
                        isEditing={true}
                      />
                    </div>
                  ) : isExpanded && (
                    <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-gray-100">
                      {question.options && (
                        <div className="space-y-1 sm:space-y-1.5 mb-1.5 sm:mb-2">
                          {question.options.map((option) => (
                            <div
                              key={option.id}
                              className={`p-1 sm:p-1.5 rounded text-xs sm:text-sm ${
                                (question.type === 'single-choice' && question.correctAnswer === option.id) ||
                                (question.type === 'multiple-choice' && (question.correctAnswer as string[]).includes(option.id))
                                  ? 'bg-green-50 border border-green-200'
                                  : 'bg-gray-50'
                              }`}
                            >
                              <span className="font-medium">{option.id}.</span> {option.content}
                            </div>
                          ))}
                        </div>
                      )}
                      {!question.options && (
                        <div className="text-xs sm:text-sm text-gray-500">
                          参考答案: {getAnswerText(question.correctAnswer)}
                        </div>
                      )}
                      {question.explanation && (
                        <div className="text-xs sm:text-sm text-gray-500 bg-gray-50 p-1 sm:p-1.5 rounded mt-1.5 sm:mt-2">
                          解析: {question.explanation}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

interface QuestionFormProps {
  form: {
    type: QuestionType;
    content: string;
    options: { id: string; content: string }[];
    correctAnswer: string | string[] | AnswerWithImages;
    score: number;
    explanation: string;
    allowDisorder: boolean;
  };
  setForm: React.Dispatch<React.SetStateAction<{
    type: QuestionType;
    content: string;
    options: { id: string; content: string }[];
    correctAnswer: string | string[] | AnswerWithImages;
    score: number;
    explanation: string;
    allowDisorder: boolean;
  }>>;
  onSave: () => void;
  onCancel: () => void;
  isEditing: boolean;
}

const QuestionForm: React.FC<QuestionFormProps> = ({ form, setForm, onSave, onCancel, isEditing }) => {
  return (
    <div className="space-y-2 sm:space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:gap-3">
        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">题目类型</label>
          <select
            value={form.type}
            onChange={(e) => {
              const newType = e.target.value as QuestionType;
              setForm(prev => ({
                ...prev,
                type: newType,
                correctAnswer: newType === 'multiple-choice' ? [] : '',
                options: newType === 'single-choice' || newType === 'multiple-choice'
                  ? prev.options
                  : []
              }));
            }}
            className="select-styled"
          >
            <option value="single-choice">单选题</option>
            <option value="multiple-choice">多选题</option>
            <option value="fill-in-blank">填空题</option>
            <option value="subjective">主观题</option>
          </select>
        </div>
        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">分值</label>
          <input
            type="number"
            value={form.score}
            onChange={(e) => setForm(prev => ({ ...prev, score: parseInt(e.target.value) || 10 }))}
            className="input-styled"
            min={1}
            max={100}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">题目内容 *</label>
        <textarea
          value={form.content}
          onChange={(e) => setForm(prev => ({ ...prev, content: e.target.value }))}
          className="input-styled"
          rows={2}
          placeholder="请输入题目内容"
        />
      </div>

      {(form.type === 'single-choice' || form.type === 'multiple-choice') && (
        <div>
          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">选项</label>
          <div className="space-y-1.5 sm:space-y-2">
            {form.options.map((option, index) => (
              <div key={option.id} className="flex items-center gap-1.5 sm:gap-2">
                <span className="w-5 sm:w-6 font-medium text-gray-600 text-xs sm:text-sm">{option.id}.</span>
                <input
                  type="text"
                  value={option.content}
                  onChange={(e) => {
                    const newOptions = [...form.options];
                    newOptions[index].content = e.target.value;
                    setForm(prev => ({ ...prev, options: newOptions }));
                  }}
                  className="input-styled flex-1 text-xs sm:text-sm py-1 sm:py-1.5"
                  placeholder={`选项 ${option.id}`}
                />
                <button
                  onClick={() => {
                    const newOptions = form.options.filter((_, i) => i !== index);
                    setForm(prev => ({ ...prev, options: newOptions }));
                  }}
                  className="p-1 sm:p-1.5 text-red-500 hover:bg-red-100 rounded-lg transition-colors"
                >
                  <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            <button
              onClick={() => {
                const nextId = String.fromCharCode(65 + form.options.length);
                setForm(prev => ({
                  ...prev,
                  options: [...prev.options, { id: nextId, content: '' }]
                }));
              }}
              className="text-blue-500 hover:text-blue-600 text-xs sm:text-sm flex items-center gap-1 py-1"
            >
              <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              添加选项
            </button>
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">正确答案 *</label>
        {form.type === 'single-choice' && (
          <select
            value={form.correctAnswer as string}
            onChange={(e) => setForm(prev => ({ ...prev, correctAnswer: e.target.value }))}
            className="select-styled"
          >
            <option value="">请选择正确答案</option>
            {form.options.filter(o => o.content.trim()).map(option => (
              <option key={option.id} value={option.id}>{option.id}. {option.content}</option>
            ))}
          </select>
        )}
        {form.type === 'multiple-choice' && (
          <div className="space-y-1 sm:space-y-1.5">
            {form.options.filter(o => o.content.trim()).map(option => (
              <label key={option.id} className="flex items-center gap-2 sm:gap-3 p-1.5 sm:p-2.5 bg-gray-50 rounded-xl hover:bg-blue-50 cursor-pointer transition-colors border-2 border-transparent hover:border-blue-200">
                <input
                  type="checkbox"
                  checked={(form.correctAnswer as string[]).includes(option.id)}
                  onChange={(e) => {
                    const current = form.correctAnswer as string[];
                    const newAnswer = e.target.checked
                      ? [...current, option.id]
                      : current.filter(id => id !== option.id);
                    setForm(prev => ({ ...prev, correctAnswer: newAnswer }));
                  }}
                  className="checkbox-styled"
                />
                <span className="text-xs sm:text-sm">{option.id}. {option.content}</span>
              </label>
            ))}
          </div>
        )}
        {form.type === 'fill-in-blank' && (
          <div>
            <p className="text-xs sm:text-sm text-gray-500 mb-1">多个答案用逗号分隔</p>
            <input
              type="text"
              value={Array.isArray(form.correctAnswer) ? form.correctAnswer.join(', ') : form.correctAnswer as string}
              onChange={(e) => {
                const answers = e.target.value.split(',').map(a => a.trim()).filter(a => a);
                setForm(prev => ({ ...prev, correctAnswer: answers }));
              }}
              className="input-styled"
              placeholder="答案1, 答案2, 答案3"
            />
            <label className="flex items-center gap-2 mt-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.allowDisorder}
                onChange={(e) => setForm(prev => ({ ...prev, allowDisorder: e.target.checked }))}
                className="checkbox-styled"
              />
              <span className="text-xs sm:text-sm text-gray-600">允许答案乱序（用户答案顺序不影响判分）</span>
            </label>
          </div>
        )}
        {form.type === 'subjective' && (
          <textarea
            value={form.correctAnswer as string}
            onChange={(e) => setForm(prev => ({ ...prev, correctAnswer: e.target.value }))}
            className="input-styled"
            rows={2}
            placeholder="请输入参考答案"
          />
        )}
      </div>

      <div>
        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-1">解析（可选）</label>
        <textarea
          value={form.explanation}
          onChange={(e) => setForm(prev => ({ ...prev, explanation: e.target.value }))}
          className="input-styled"
          rows={2}
          placeholder="请输入题目解析"
        />
      </div>

      <div className="flex justify-end gap-2 pt-1 sm:pt-2">
        <button
          onClick={onCancel}
          className="btn-secondary"
        >
          取消
        </button>
        <button onClick={onSave} className="btn-primary">
          {isEditing ? '保存' : '添加'}
        </button>
      </div>
    </div>
  );
};

export default QuestionBankDetail;
