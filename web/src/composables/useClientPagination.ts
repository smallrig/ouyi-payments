import { computed, ref, watch, type MaybeRefOrGetter, toValue } from 'vue';

export const PAGE_SIZES = [10, 20, 50];

/** 前端列表分页（数据已全部加载到内存） */
export function useClientPagination<T>(source: MaybeRefOrGetter<T[]>, defaultPageSize = 10) {
  const page = ref(1);
  const pageSize = ref(defaultPageSize);

  const total = computed(() => toValue(source).length);

  const paged = computed(() => {
    const list = toValue(source);
    const start = (page.value - 1) * pageSize.value;
    return list.slice(start, start + pageSize.value);
  });

  const pageCount = computed(() => Math.max(1, Math.ceil(total.value / pageSize.value) || 1));

  function resetPage() {
    page.value = 1;
  }

  watch(
    () => toValue(source),
    () => {
      const maxPage = Math.max(1, Math.ceil(toValue(source).length / pageSize.value) || 1);
      if (page.value > maxPage) page.value = maxPage;
    }
  );

  watch(pageSize, () => {
    page.value = 1;
  });

  /** Naive DataTable 用的 pagination 配置（需在 computed 中调用以保持响应） */
  function tablePagination() {
    return {
      page: page.value,
      pageSize: pageSize.value,
      itemCount: total.value,
      pageSizes: PAGE_SIZES,
      showSizePicker: true,
      prefix: ({ itemCount }: { itemCount?: number }) => `共 ${itemCount ?? 0} 条`,
      onUpdatePage: (p: number) => {
        page.value = p;
      },
      onUpdatePageSize: (ps: number) => {
        pageSize.value = ps;
        page.value = 1;
      }
    };
  }

  return {
    page,
    pageSize,
    pageSizes: PAGE_SIZES,
    total,
    paged,
    pageCount,
    resetPage,
    tablePagination
  };
}
