import { reactive, ref, shallowRef } from "vue";

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

/** 保存回调为同步会话动作；不承担网络持久化或真实认证。 */
export function useDraftForm<T extends object>(options: {
  read: () => T;
  clone: (value: T) => T;
  validate: (value: T) => FieldErrors<T>;
  save: (value: T) => void;
}) {
  const opened = ref(false);
  const copy = () => reactive(options.clone(options.read())) as T;
  const draft = shallowRef(copy());
  const errors = shallowRef<FieldErrors<T>>({});
  const firstError = ref("");
  const submitting = ref(false);
  const submitError = ref("");

  function begin() {
    if (submitting.value) return;
    draft.value = copy();
    errors.value = {};
    firstError.value = "";
    submitError.value = "";
    opened.value = true;
  }
  function cancel() {
    opened.value = false;
    draft.value = copy();
    errors.value = {};
    firstError.value = "";
    submitError.value = "";
  }
  function submit() {
    if (!opened.value || submitting.value) return false;
    errors.value = options.validate(draft.value);
    firstError.value =
      Object.keys(errors.value).find((key) => errors.value[key as keyof T]) ??
      "";
    if (firstError.value) return false;
    submitting.value = true;
    try {
      options.save(options.clone(draft.value));
      cancel();
      return true;
    } catch {
      submitError.value = "保存失败，请重试；修改内容已保留。";
      return false;
    } finally {
      submitting.value = false;
    }
  }
  return {
    opened,
    draft,
    errors,
    firstError,
    submitting,
    submitError,
    begin,
    cancel,
    submit,
  };
}
