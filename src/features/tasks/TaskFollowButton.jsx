import { useDispatch, useSelector } from 'react-redux';
import { Bell, BellRing } from 'lucide-react';
import { setTaskFollowing } from './taskFollowing.js';

export default function TaskFollowButton({ taskId }) {
    const dispatch = useDispatch();
    const task = useSelector((state) => state.workspace.tasks.find((item) => item.id === taskId));
    const mutation = useSelector((state) => state.workspace.taskFollowing?.[taskId]);
    if (!task) {
        return null;
    }
    const following = Boolean(task.isFollowed);
    return <div className="task-follow-control">
        <button type="button" className="button" aria-pressed={following}
            disabled={Boolean(mutation?.requestId)} title={following ? 'Unfollow this task' : 'Get notifications for task updates'}
            onClick={() => dispatch(setTaskFollowing({ taskId, isFollowed: !following }))}>
            {following ? <BellRing size={16} /> : <Bell size={16} />}
            {mutation?.requestId ? 'Updating…' : following ? 'Following' : 'Follow'}
        </button>
        {mutation?.error && <span role="alert" className="error">{mutation.error}</span>}
    </div>;
}
