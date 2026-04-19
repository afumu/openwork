<route lang="yaml">
meta:
  title: 基础设置
</route>

<script lang="ts" setup>
  import apiConfig from '@/api/modules/config';
  import { QuestionFilled } from '@element-plus/icons-vue';
  import type { FormInstance, FormRules } from 'element-plus';
  import { ElMessage } from 'element-plus';
  import { computed, onMounted, reactive, ref } from 'vue';

  type VoiceOption = { label: string; value: string };
  type SearchSourceType =
    | 'tavily'
    | 'bochai'
    | 'bigmodel'
    | 'custom'
    | 'duckduckgo'
    | 'hackernews'
    | 'sogou'
    | 'bilibili'
    | 'weibo'
    | 'bing'
    | 'google';
  type SearchCenterMode = 'fallback' | 'aggregate' | 'smart';
  type SearchSourceConfig = {
    id: string;
    name: string;
    type: SearchSourceType;
    url: string;
    key: string;
    enabled: number;
    priority: number;
    useForChat: number;
    useForResearch: number;
    weight: number;
    maxResults?: number;
  };

  const formInline = reactive({
    openaiBaseUrl: '',
    openaiBaseKey: '',
    deepThinkingModel: 'deepseek-reasoner',
    deepThinkingUrl: '',
    deepThinkingKey: '',
    openaiBaseModel: 'gpt-4o-mini',
    isGeneratePromptReference: 0,
    isConvertToBase64: 0,
    openaiVoice: '',
    systemPreMessage: '',
    isModelInherited: 1,
    pluginUrl: '',
    pluginKey: '',
    searchCenterMode: 'fallback' as SearchCenterMode,
    searchCenterDiagnostics: 0,
    searchSources: [] as SearchSourceConfig[],
    openaiTemperature: 1,
    vectorUrl: '',
    vectorKey: '',
    vectorModel: 'text-embedding-3-small',
    vectorAnalysisThreshold: 1000,
    maxUrlTextLength: 100000,
    toolCallUrl: '',
    toolCallKey: '',
    toolCallModel: '',
    imageAnalysisUrl: '',
    imageAnalysisKey: '',
    imageAnalysisModel: '',
  });

  const options = [
    {
      value: 'https://api.deepseek.com',
      label: '【DeepSeek 官方】https://api.deepseek.com',
    },
    {
      value: 'https://dashscope.aliyuncs.com/compatible-mode',
      label: '【阿里云百炼】https://dashscope.aliyuncs.com/compatible-mode',
    },
    {
      value: 'https://api.lkeap.cloud.tencent.com',
      label: '【腾讯云知识引擎】https://api.lkeap.cloud.tencent.com',
    },
    {
      value: 'https://api.openai.com/v1',
      label: '【OpenAI 官方】https://api.openai.com/v1',
    },
    {
      value: '',
      label: '【其他】填写后选择',
    },
  ];

  const voiceOptions = ref<VoiceOption[]>([
    { label: 'Alloy', value: 'alloy' },
    { label: 'Echo', value: 'echo' },
    { label: 'Fable', value: 'fable' },
    { label: 'Onyx', value: 'onyx' },
    { label: 'Nova', value: 'nova' },
    { label: 'Shimmer', value: 'shimmer' },
  ]);

  const netWorkOptions = [
    {
      value: 'https://open.bigmodel.cn/api/paas/v4/tools',
      label: '【智谱 web-search-pro】',
    },
    {
      value: 'https://api.bochaai.com/v1/web-search',
      label: '【博查 web-search】',
    },
    {
      value: 'https://api.tavily.com/search',
      label: '【Tavily 1000 次/月（免费）】',
    },
  ];

  const vectorOptions = [
    {
      value: 'text-embedding-3-small',
      label: 'text-embedding-3-small',
    },
    {
      value: 'text-embedding-3-large',
      label: 'text-embedding-3-large',
    },
    {
      value: 'text-embedding-ada-002',
      label: 'text-embedding-ada-002',
    },
  ];

  const searchSourceTypeOptions: { label: string; value: SearchSourceType }[] = [
    { label: 'Tavily', value: 'tavily' },
    { label: '博查', value: 'bochai' },
    { label: '智谱', value: 'bigmodel' },
    { label: '自定义', value: 'custom' },
    { label: 'DuckDuckGo（免费）', value: 'duckduckgo' },
    { label: 'Hacker News（免费）', value: 'hackernews' },
    { label: '搜狗（免费）', value: 'sogou' },
    { label: 'Bilibili（免费）', value: 'bilibili' },
    { label: '微博热搜（免费）', value: 'weibo' },
    { label: 'Bing（免费抓取）', value: 'bing' },
    { label: 'Google（免费抓取）', value: 'google' },
  ];

  const searchCenterModeOptions: { label: string; value: SearchCenterMode }[] = [
    { label: '回退模式：按优先级依次尝试', value: 'fallback' },
    { label: '聚合模式：多源同时纳入排序', value: 'aggregate' },
    { label: '智能模式：先少量命中，不足时自动扩展', value: 'smart' },
  ];

  const searchSourceUrlMap: Record<SearchSourceType, string> = {
    tavily: 'https://api.tavily.com/search',
    bochai: 'https://api.bochaai.com/v1/web-search',
    bigmodel: 'https://open.bigmodel.cn/api/paas/v4/tools',
    custom: '',
    duckduckgo: 'https://html.duckduckgo.com/html/',
    hackernews: 'https://hn.algolia.com/api/v1/search',
    sogou: 'https://www.sogou.com/web',
    bilibili: 'https://api.bilibili.com/x/web-interface/search/type',
    weibo: 'https://weibo.com/ajax/side/hotSearch',
    bing: 'https://www.bing.com/search',
    google: 'https://www.google.com/search',
  };

  const managedSearchSourceTypes = new Set<SearchSourceType>([
    'duckduckgo',
    'hackernews',
    'sogou',
    'bilibili',
    'weibo',
    'bing',
    'google',
  ]);

  const quickAddManagedSourceOptions: { label: string; value: SearchSourceType }[] = [
    { label: 'DuckDuckGo', value: 'duckduckgo' },
    { label: 'Hacker News', value: 'hackernews' },
    { label: '搜狗', value: 'sogou' },
    { label: 'B 站', value: 'bilibili' },
    { label: '微博热搜', value: 'weibo' },
    { label: 'Bing', value: 'bing' },
    { label: 'Google', value: 'google' },
  ];

  const rules = ref<FormRules>({
    openaiBaseUrl: [{ required: true, trigger: 'blur', message: '请填写 AI 的请求地址' }],
    openaiBaseKey: [{ required: true, trigger: 'blur', message: '请填写模型全局 Key' }],
    openaiBaseModel: [
      { required: true, trigger: 'blur', message: '请填写全局模型，用于后台一些静默性赋能操作' },
    ],
    isGeneratePromptReference: [
      { required: false, trigger: 'blur', message: '是否生成提示词参考' },
    ],
    isModelInherited: [{ required: false, trigger: 'blur', message: '是否继承模型' }],
    pluginUrl: [{ required: false, trigger: 'blur', message: '请填写联网插件地址' }],
    pluginKey: [{ required: false, trigger: 'blur', message: '请填写联网插件 Key' }],
    openaiTemperature: [
      {
        required: false,
        trigger: 'blur',
        message: '请填写模型 Temperature 设置，默认1',
      },
    ],
    deepThinkingUrl: [{ required: false, trigger: 'blur', message: '请填写深度思考模型地址' }],
    deepThinkingKey: [{ required: false, trigger: 'blur', message: '请填写深度思考模型 Key' }],
    deepThinkingModel: [
      {
        required: false,
        trigger: 'blur',
        message: '请填写深度思考模型名称',
      },
    ],
    vectorUrl: [{ required: false, trigger: 'blur', message: '请填写向量模型地址' }],
    vectorKey: [{ required: false, trigger: 'blur', message: '请填写向量模型 Key' }],
    vectorModel: [{ required: false, trigger: 'blur', message: '请填写向量模型名称' }],
    vectorAnalysisThreshold: [
      { required: false, trigger: 'blur', message: '请填写文件启用向量分析阈值' },
    ],
    maxUrlTextLength: [{ required: false, trigger: 'blur', message: '请填写文件最大字符限制' }],
    toolCallUrl: [{ required: false, trigger: 'blur', message: '请填写工具调用模型地址' }],
    toolCallKey: [{ required: false, trigger: 'blur', message: '请填写工具调用模型 Key' }],
    toolCallModel: [{ required: false, trigger: 'blur', message: '请填写工具调用模型名称' }],
    imageAnalysisUrl: [{ required: false, trigger: 'blur', message: '请填写图片解析模型地址' }],
    imageAnalysisKey: [{ required: false, trigger: 'blur', message: '请填写图片解析模型 Key' }],
    imageAnalysisModel: [{ required: false, trigger: 'blur', message: '请填写图片解析模型名称' }],
  });
  const formRef = ref<FormInstance>();

  function createSearchSource(partial: Partial<SearchSourceConfig> = {}): SearchSourceConfig {
    const fallbackType: SearchSourceType = partial.type || 'tavily';
    const nextPriority = partial.priority ?? formInline.searchSources.length + 1;
    return {
      id: partial.id || `search-source-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: partial.name || '',
      type: fallbackType,
      url: partial.url || searchSourceUrlMap[fallbackType],
      key: partial.key || '',
      enabled: partial.enabled ?? 1,
      priority: nextPriority,
      useForChat: partial.useForChat ?? 1,
      useForResearch: partial.useForResearch ?? 1,
      weight: Number(partial.weight ?? 1),
      maxResults: partial.maxResults,
    };
  }

  function detectSearchSourceType(url = ''): SearchSourceType {
    if (url.includes('tavily.com')) return 'tavily';
    if (url.includes('bochaai.com')) return 'bochai';
    if (url.includes('bigmodel.cn')) return 'bigmodel';
    if (url.includes('duckduckgo.com')) return 'duckduckgo';
    if (url.includes('hn.algolia.com')) return 'hackernews';
    if (url.includes('sogou.com')) return 'sogou';
    if (url.includes('bilibili.com')) return 'bilibili';
    if (url.includes('weibo.com')) return 'weibo';
    if (url.includes('bing.com')) return 'bing';
    if (url.includes('google.com')) return 'google';
    return 'custom';
  }

  function isManagedSearchSource(type: SearchSourceType) {
    return managedSearchSourceTypes.has(type);
  }

  function getSearchSourceTypeLabel(type: SearchSourceType) {
    return searchSourceTypeOptions.find((item) => item.value === type)?.label || type;
  }

  function normalizeSearchSources(
    rawSearchSources: unknown,
    pluginUrl = '',
    pluginKey = '',
  ): SearchSourceConfig[] {
    let parsedSources: unknown[] = [];

    if (typeof rawSearchSources === 'string' && rawSearchSources.trim()) {
      try {
        const json = JSON.parse(rawSearchSources);
        if (Array.isArray(json)) {
          parsedSources = json;
        }
      } catch (error) {
        parsedSources = [];
      }
    } else if (Array.isArray(rawSearchSources)) {
      parsedSources = rawSearchSources;
    }

    const normalized = parsedSources
      .filter((item): item is Record<string, any> => !!item)
      .map((item, index) =>
        createSearchSource({
          id: String(item.id || `search-source-${index + 1}`),
          name: String(item.name || `搜索源 ${index + 1}`),
          type: (item.type as SearchSourceType) || detectSearchSourceType(String(item.url || '')),
          url: String(
            item.url ||
              searchSourceUrlMap[
                (item.type as SearchSourceType) || detectSearchSourceType(String(item.url || ''))
              ] ||
              '',
          ),
          key: String(item.key || ''),
          enabled: Number(item.enabled ?? 1),
          priority: Number(item.priority ?? index + 1),
          useForChat: Number(item.useForChat ?? 1),
          useForResearch: Number(item.useForResearch ?? 1),
          weight: Number(item.weight ?? 1),
          maxResults: item.maxResults ? Number(item.maxResults) : undefined,
        }),
      )
      .filter((item) => isManagedSearchSource(item.type) || item.url || item.key);

    if (normalized.length > 0) {
      return normalized.sort((a, b) => a.priority - b.priority);
    }

    if (pluginUrl || pluginKey) {
      return [
        createSearchSource({
          id: 'legacy-search-source',
          name: '默认搜索源',
          type: detectSearchSourceType(pluginUrl),
          url: pluginUrl,
          key: pluginKey,
          enabled: 1,
          priority: 1,
          useForChat: 1,
          useForResearch: 1,
          weight: 1,
          maxResults: undefined,
        }),
      ];
    }

    return [createSearchSource()];
  }

  function getPrimarySearchSource(sources: SearchSourceConfig[]) {
    const enabledSources = sources
      .filter(
        (item) =>
          Number(item.enabled) === 1 && (isManagedSearchSource(item.type) || item.url || item.key),
      )
      .sort((a, b) => a.priority - b.priority);
    return (
      enabledSources[0] ||
      sources.find((item) => isManagedSearchSource(item.type) || item.url || item.key) ||
      null
    );
  }

  function serializeSearchSources(sources: SearchSourceConfig[]) {
    return JSON.stringify(
      sources
        .map((item, index) => ({
          id: item.id,
          name: item.name?.trim() || `搜索源 ${index + 1}`,
          type: item.type,
          url: item.url?.trim() || '',
          key: item.key?.trim() || '',
          enabled: Number(item.enabled) === 1 ? 1 : 0,
          priority: Number(item.priority ?? index + 1),
          useForChat: Number(item.useForChat) === 0 ? 0 : 1,
          useForResearch: Number(item.useForResearch) === 0 ? 0 : 1,
          weight: Number.isFinite(Number(item.weight)) ? Number(item.weight) : 1,
          maxResults:
            item.maxResults && Number.isFinite(Number(item.maxResults))
              ? Number(item.maxResults)
              : undefined,
        }))
        .filter((item) => managedSearchSourceTypes.has(item.type) || (item.url && item.key)),
    );
  }

  function addSearchSource(type: SearchSourceType = 'tavily') {
    formInline.searchSources.push(
      createSearchSource({
        type,
        name: `搜索源 ${formInline.searchSources.length + 1}`,
        priority: formInline.searchSources.length + 1,
      }),
    );
  }

  function removeSearchSource(index: number) {
    formInline.searchSources.splice(index, 1);
    if (formInline.searchSources.length === 0) {
      formInline.searchSources.push(createSearchSource());
    }
    formInline.searchSources.forEach((item, itemIndex) => {
      item.priority = itemIndex + 1;
    });
  }

  function handleSearchSourceTypeChange(source: SearchSourceConfig) {
    const defaultUrl = searchSourceUrlMap[source.type];
    source.url = defaultUrl || source.url;
    if (isManagedSearchSource(source.type)) {
      source.key = '';
    }
    if (!source.name?.trim()) {
      source.name = getSearchSourceTypeLabel(source.type);
    }
  }

  async function queryAllconfig() {
    const res = await apiConfig.queryConfig({
      keys: [
        'openaiBaseUrl',
        'openaiBaseKey',
        'openaiBaseModel',
        'systemPreMessage',
        'isGeneratePromptReference',
        'isConvertToBase64',
        'openaiVoice,',
        'isModelInherited',
        'pluginUrl',
        'pluginKey',
        'searchCenterMode',
        'searchCenterDiagnostics',
        'searchSources',
        'openaiTemperature',
        'deepThinkingUrl',
        'deepThinkingKey',
        'deepThinkingModel',
        'vectorUrl',
        'vectorKey',
        'vectorModel',
        'vectorAnalysisThreshold',
        'maxUrlTextLength',
        'openaiVoice',
        'toolCallUrl',
        'toolCallKey',
        'toolCallModel',
        'imageAnalysisUrl',
        'imageAnalysisKey',
        'imageAnalysisModel',
      ],
    });
    const {
      openaiBaseUrl = '',
      openaiBaseKey = '',
      openaiBaseModel = 'gpt-4o-mini',
      isGeneratePromptReference = 0,
      systemPreMessage,
      pluginUrl,
      pluginKey,
      searchCenterMode = 'fallback',
      searchCenterDiagnostics = 0,
      searchSources,
      openaiTemperature = 1,
      deepThinkingUrl,
      deepThinkingKey,
      deepThinkingModel,
      isModelInherited,
      vectorUrl,
      vectorKey,
      isConvertToBase64,
      openaiVoice,
      vectorModel = 'text-embedding-3-small',
      vectorAnalysisThreshold = 10000,
      maxUrlTextLength = 500000,
      toolCallUrl,
      toolCallKey,
      toolCallModel = '',
      imageAnalysisUrl,
      imageAnalysisKey,
      imageAnalysisModel = '',
    } = res.data;
    Object.assign(formInline, {
      openaiBaseUrl,
      openaiBaseKey,
      isGeneratePromptReference,
      isConvertToBase64,
      openaiVoice,
      openaiBaseModel,
      systemPreMessage,
      pluginUrl,
      pluginKey,
      searchCenterMode:
        searchCenterMode === 'aggregate'
          ? 'aggregate'
          : searchCenterMode === 'smart'
            ? 'smart'
            : 'fallback',
      searchCenterDiagnostics: Number(searchCenterDiagnostics) === 1 ? 1 : 0,
      searchSources: normalizeSearchSources(searchSources, pluginUrl, pluginKey),
      openaiTemperature,
      deepThinkingKey,
      deepThinkingUrl,
      deepThinkingModel,
      isModelInherited,
      vectorUrl,
      vectorKey,
      vectorModel,
      vectorAnalysisThreshold,
      maxUrlTextLength,
      toolCallUrl,
      toolCallKey,
      toolCallModel,
      imageAnalysisUrl,
      imageAnalysisKey,
      imageAnalysisModel,
    });
  }

  function handlerUpdateConfig() {
    formRef.value?.validate(async (valid) => {
      if (valid) {
        try {
          await apiConfig.setConfig({ settings: fotmatSetting(formInline) });
          ElMessage.success('变更配置信息成功');
        } catch (error) {}
        queryAllconfig();
      } else {
        ElMessage.error('请填写完整信息');
      }
    });
  }

  function fotmatSetting(settings: any) {
    const serializedSearchSources = serializeSearchSources(settings.searchSources || []);
    const primarySearchSource = getPrimarySearchSource(settings.searchSources || []);
    const baseSettings = Object.keys(settings)
      .filter((key) => !['searchSources', 'pluginUrl', 'pluginKey'].includes(key))
      .map((key) => {
        return {
          configKey: key,
          configVal: settings[key],
        };
      });

    baseSettings.push({
      configKey: 'searchSources',
      configVal: serializedSearchSources,
    });
    baseSettings.push({
      configKey: 'pluginUrl',
      configVal: primarySearchSource?.url || '',
    });
    baseSettings.push({
      configKey: 'pluginKey',
      configVal: primarySearchSource?.key || '',
    });
    return baseSettings;
  }

  onMounted(() => {
    queryAllconfig();
  });

  /**
   * 规范化API基础URL
   * @param baseUrl - 需要规范化的API基础URL
   * @returns 规范化后的URL字符串
   */
  const correctApiBaseUrl = (baseUrl: string): string => {
    if (!baseUrl) return '';

    // 去除两端空格
    let url = baseUrl.trim();

    // 如果URL以斜杠'/'结尾，则移除这个斜杠
    if (url.endsWith('/')) {
      url = url.slice(0, -1);
    }

    // 检查URL是否已包含任何版本标记，包括常见的模式如/v1, /v1beta, /v1alpha等
    if (!/\/v\d+(?:beta|alpha)?/.test(url)) {
      // 如果不包含任何版本号，添加 /v1
      return `${url}/v1`;
    }

    return url;
  };

  // Computed properties for actual URLs
  const actualOpenaiBaseUrl = computed(() => correctApiBaseUrl(formInline.openaiBaseUrl));
  const actualDeepThinkingUrl = computed(() => correctApiBaseUrl(formInline.deepThinkingUrl));
  const actualVectorUrl = computed(() => correctApiBaseUrl(formInline.vectorUrl));
  const actualToolCallUrl = computed(() => correctApiBaseUrl(formInline.toolCallUrl));
  const actualImageAnalysisUrl = computed(() => correctApiBaseUrl(formInline.imageAnalysisUrl));
</script>

<template>
  <div>
    <PageHeader>
      <template #title>
        <div class="flex items-center gap-4">基础设置</div>
      </template>
      <template #content>
        <div class="text-sm/6">
          <div>
            全局配置用于对话标题生成、生成提问建议、提示词翻译等内置操作。模型不配置 Url 或 Key
            时，也会使用全局配置。
          </div>
          <div>
            <strong>重要提示：</strong
            >向量模型、工具调用模型、图片解析模型和深度思考模型如果没有单独设置，系统将默认使用全局模型的地址和
            Key，请确保全局配置正确填写。
          </div>
          <div>全局地址支持填写任意兼容 OpenAI 的模型网关或自建代理地址。</div>
          <div>深度思考模型用于模型的深度思考，需在模型配置中开启深度思考模式。</div>
          <div>
            联网插件已支持多种方式：

            <a href="https://bigmodel.cn" target="_blank">智谱 web-search-pro</a>、
            <a href="https://open.bochaai.com" target="_blank">博查 web-search</a>、
            <a href="https://app.tavily.com/home" target="_blank">Tavily</a>
            需自行登录以上网站，获取对应的 Key（多个Key用英文逗号隔开）。
          </div>
        </div>
      </template>
      <HButton text outline @click="handlerUpdateConfig">
        <SvgIcon name="i-ri:file-text-line" />
        保存设置
      </HButton>
    </PageHeader>
    <el-card style="margin: 20px">
      <el-form ref="formRef" :rules="rules" :model="formInline" label-width="220px">
        <h3 class="font-bold text-lg mb-4">基础配置 <el-divider /></h3>
        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="全局地址" prop="openaiBaseUrl" label-width="120px" required>
              <el-input
                v-model="formInline.openaiBaseUrl"
                placeholder="例如 https://api.openai.com，未显式指定 /v1 等版本时将自动添加 /v1"
                clearable
              />
              <div v-if="actualOpenaiBaseUrl" class="text-xs text-gray-400 mt-1">
                实际调用地址：{{ actualOpenaiBaseUrl }}
              </div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="全局 Key" prop="openaiBaseKey" label-width="120px" required>
              <el-input
                v-model="formInline.openaiBaseKey"
                placeholder="请填写模型全局 Key 信息，当模型 Key 为空时调用"
                type="password"
                show-password
                clearable
              />
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="全局模型" prop="openaiBaseModel" label-width="120px" required>
              <el-input
                v-model="formInline.openaiBaseModel"
                placeholder="全局模型配置，用于后台一些静默赋能操作"
                clearable
              />
            </el-form-item>
          </el-col>
        </el-row>

        <h3 class="font-bold text-lg mt-8 mb-4">深度思考配置 <el-divider /></h3>
        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="深度思考地址" prop="deepThinkingUrl" label-width="120px">
              <el-select
                v-model="formInline.deepThinkingUrl"
                placeholder="选择或输入地址，未指定 /v1 等版本时将自动添加 /v1"
                clearable
                filterable
                allow-create
              >
                <el-option
                  v-for="option in options"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
              <div v-if="actualDeepThinkingUrl" class="text-xs text-gray-400 mt-1">
                实际调用地址：{{ actualDeepThinkingUrl }}
              </div>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="深度思考 Key" prop="deepThinkingKey" label-width="120px">
              <el-input
                v-model="formInline.deepThinkingKey"
                placeholder="请填写深度思考模型 Key"
                type="password"
                show-password
                clearable
              />
            </el-form-item>
          </el-col>
        </el-row>

        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="深度思考模型" prop="deepThinkingModel" label-width="120px">
              <el-input
                v-model="formInline.deepThinkingModel"
                placeholder="请选择深度思考模型"
                clearable
              >
              </el-input>
            </el-form-item>
          </el-col>
        </el-row>

        <h3 class="font-bold text-lg mt-8 mb-4">联网配置 <el-divider /></h3>
        <el-row>
          <el-col :xs="24" :md="24" :lg="20" :xl="18">
            <el-row :gutter="16" class="mb-2">
              <el-col :xs="24" :md="14">
                <el-form-item label="搜索模式" prop="searchCenterMode" label-width="110px">
                  <el-select v-model="formInline.searchCenterMode" placeholder="请选择搜索模式">
                    <el-option
                      v-for="option in searchCenterModeOptions"
                      :key="option.value"
                      :label="option.label"
                      :value="option.value"
                    />
                  </el-select>
                  <div class="text-xs text-gray-400 mt-1">
                    回退模式兼容旧逻辑；聚合模式会并行合并多个源；智能模式会先命中最匹配的源，不足时再自动扩展。
                  </div>
                </el-form-item>
              </el-col>
              <el-col :xs="24" :md="10">
                <el-form-item label="诊断日志" prop="searchCenterDiagnostics" label-width="110px">
                  <el-switch
                    v-model="formInline.searchCenterDiagnostics"
                    :active-value="1"
                    :inactive-value="0"
                  />
                  <span class="ml-3 text-xs text-gray-400">
                    开启后返回并打印每个搜索源的命中情况
                  </span>
                </el-form-item>
              </el-col>
            </el-row>

            <div class="mb-4 flex items-center justify-between">
              <div class="text-sm text-gray-500">
                支持配置多个搜索源，普通搜索和 Research 工作流可以分别开关。免费内建源不需要手填 URL
                / Key，只有 API 型搜索源才需要配置密钥。
              </div>
              <el-button type="primary" plain @click="addSearchSource()">新增搜索源</el-button>
            </div>

            <div class="mb-4 flex flex-wrap gap-2">
              <span class="text-xs text-gray-400 leading-8">快速添加免费源：</span>
              <el-button
                v-for="option in quickAddManagedSourceOptions"
                :key="option.value"
                plain
                size="small"
                @click="addSearchSource(option.value)"
              >
                {{ option.label }}
              </el-button>
            </div>

            <div
              v-for="(source, index) in formInline.searchSources"
              :key="source.id"
              class="mb-4 rounded-lg border border-solid border-gray-200 p-4"
            >
              <div class="mb-3 flex items-center justify-between">
                <div class="font-medium">搜索源 {{ index + 1 }}</div>
                <el-button
                  text
                  type="danger"
                  :disabled="formInline.searchSources.length === 1"
                  @click="removeSearchSource(index)"
                >
                  删除
                </el-button>
              </div>

              <el-row :gutter="16">
                <el-col :xs="24" :md="12">
                  <el-form-item :label="`名称 ${index + 1}`" label-width="110px">
                    <el-input v-model="source.name" placeholder="例如 Tavily 主搜索" clearable />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :md="12">
                  <el-form-item :label="`类型 ${index + 1}`" label-width="110px">
                    <el-select
                      v-model="source.type"
                      placeholder="请选择搜索源类型"
                      @change="handleSearchSourceTypeChange(source)"
                    >
                      <el-option
                        v-for="option in searchSourceTypeOptions"
                        :key="option.value"
                        :label="option.label"
                        :value="option.value"
                      />
                    </el-select>
                  </el-form-item>
                </el-col>
              </el-row>

              <el-row :gutter="16">
                <el-col :xs="24" :md="16">
                  <el-form-item :label="`地址 ${index + 1}`" label-width="110px">
                    <template v-if="!isManagedSearchSource(source.type)">
                      <el-select
                        v-model="source.url"
                        placeholder="请选择或输入联网搜索地址"
                        clearable
                        filterable
                        allow-create
                      >
                        <el-option
                          v-for="option in netWorkOptions"
                          :key="option.value"
                          :label="option.label"
                          :value="option.value"
                        />
                      </el-select>
                    </template>
                    <template v-else>
                      <el-input
                        v-model="source.url"
                        disabled
                        placeholder="内建免费源，地址由系统自动管理"
                      />
                      <div class="text-xs text-gray-400 mt-1">
                        当前为内建免费源，使用系统默认地址与抓取规则。
                      </div>
                    </template>
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :md="8">
                  <el-form-item :label="`优先级 ${index + 1}`" label-width="110px">
                    <el-input-number v-model="source.priority" :min="1" :step="1" />
                  </el-form-item>
                </el-col>
              </el-row>

              <el-row :gutter="16">
                <el-col :xs="24" :md="16">
                  <el-form-item :label="`Key ${index + 1}`" label-width="110px">
                    <template v-if="!isManagedSearchSource(source.type)">
                      <el-input
                        v-model="source.key"
                        placeholder="请输入搜索源 Key，多个 Key 用英文逗号隔开"
                        type="password"
                        show-password
                        clearable
                      />
                    </template>
                    <template v-else>
                      <el-input
                        v-model="source.key"
                        disabled
                        placeholder="内建免费源无需配置 Key"
                      />
                    </template>
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :md="8">
                  <el-form-item :label="`启用 ${index + 1}`" label-width="110px">
                    <el-switch v-model="source.enabled" :active-value="1" :inactive-value="0" />
                  </el-form-item>
                </el-col>
              </el-row>

              <el-row :gutter="16">
                <el-col :xs="24" :md="8">
                  <el-form-item :label="`普通搜索 ${index + 1}`" label-width="110px">
                    <el-switch v-model="source.useForChat" :active-value="1" :inactive-value="0" />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :md="8">
                  <el-form-item :label="`Research ${index + 1}`" label-width="110px">
                    <el-switch
                      v-model="source.useForResearch"
                      :active-value="1"
                      :inactive-value="0"
                    />
                  </el-form-item>
                </el-col>
                <el-col :xs="24" :md="8">
                  <el-form-item :label="`权重 ${index + 1}`" label-width="110px">
                    <el-input-number
                      v-model="source.weight"
                      :min="0"
                      :max="10"
                      :step="0.5"
                      controls-position="right"
                    />
                  </el-form-item>
                </el-col>
              </el-row>

              <el-row :gutter="16">
                <el-col :xs="24" :md="12">
                  <el-form-item :label="`单源上限 ${index + 1}`" label-width="110px">
                    <el-input-number
                      v-model="source.maxResults"
                      :min="1"
                      :max="80"
                      :step="1"
                      controls-position="right"
                      placeholder="默认跟随请求 limit"
                    />
                    <div class="text-xs text-gray-400 mt-1">
                      仅聚合模式生效，用于限制单个搜索源最多返回多少条候选。
                    </div>
                  </el-form-item>
                </el-col>
              </el-row>
            </div>
          </el-col>
        </el-row>

        <h3 class="font-bold text-lg mt-8 mb-4">其他配置 <el-divider /></h3>
        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="继承对话模型" prop="isModelInherited" label-width="120">
              <el-switch
                v-model="formInline.isModelInherited"
                active-value="1"
                inactive-value="0"
              />
              <el-tooltip class="box-item" effect="dark" placement="right">
                <template #content>
                  <div style="width: 250px">
                    <p>开启后，新建对话模型将继承上一次对话所使用的模型</p>
                  </div>
                </template>
                <el-icon class="ml-3 cursor-pointer">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="生成提问建议" prop="isGeneratePromptReference" label-width="120">
              <el-switch
                v-model="formInline.isGeneratePromptReference"
                active-value="1"
                inactive-value="0"
              />
              <el-tooltip class="box-item" effect="dark" placement="right">
                <template #content>
                  <div style="width: 250px">
                    <p>开启后，将使用全局模型在每次对话后，生成提问建议</p>
                  </div>
                </template>
                <el-icon class="ml-3 cursor-pointer">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="Base64 识图" prop="isConvertToBase64" label-width="120">
              <el-switch
                v-model="formInline.isConvertToBase64"
                active-value="1"
                inactive-value="0"
              />
              <el-tooltip class="box-item" effect="dark" placement="right">
                <template #content>
                  <div style="width: 250px">
                    <p>
                      开启后，识图时将使用 base64 格式，对于本地/存储桶 链接 API
                      端无法访问时建议开启
                    </p>
                  </div>
                </template>
                <el-icon class="ml-3 cursor-pointer">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </el-form-item>
          </el-col>
        </el-row>

        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="TTS 音色" prop="openaiVoice" label-width="120px">
              <el-select
                v-model="formInline.openaiVoice"
                placeholder="选择或输入 openai 语音合成的默认发音人"
                clearable
                filterable
                allow-create
              >
                <!-- 预定义选项 -->
                <el-option
                  v-for="voice in voiceOptions"
                  :key="voice.value"
                  :label="voice.label"
                  :value="voice.value"
                />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="Temperature" prop="openaiTemperature" label-width="120px">
              <el-input-number
                v-model="formInline.openaiTemperature"
                controls-position="right"
                :min="0"
                :max="2"
                :step="0.1"
                placeholder="模型 Temperature 设置，默认1"
                clearable
              />
              <el-tooltip class="box-item" effect="dark" placement="right">
                <template #content>
                  <div style="width: 250px">
                    <p>模型 Temperature 设置，一般情况无需调整</p>
                  </div>
                </template>
                <el-icon class="ml-3 cursor-pointer">
                  <QuestionFilled />
                </el-icon>
              </el-tooltip>
            </el-form-item>
          </el-col>
        </el-row>
        <el-row>
          <el-col :xs="24" :md="20" :lg="15" :xl="12">
            <el-form-item label="全局头部预设" prop="systemPreMessage" label-width="120px">
              <el-input
                v-model="formInline.systemPreMessage"
                type="textarea"
                :rows="8"
                placeholder="请填写模型全局头部预设信息！"
                clearable
              />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
    </el-card>
  </div>
</template>
