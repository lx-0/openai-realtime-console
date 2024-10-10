export async function _onTool(args: unknown, handler: any) {
  try {
    return (await handler(args)) ?? { success: true };
  } catch (error: any) {
    console.error('Error handling tool:', error);
    return { error: error.message };
  }
}
