import { useSearchParams } from 'react-router-dom';
import './following-filter.css';

export function followingSearch(search) {
    return new URLSearchParams(search).get('following') === '1' ? '?following=1' : '';
}

export default function FollowingFilter() {
    const [params, setParams] = useSearchParams();
    const active = params.get('following') === '1';

    function update(active) {
        const next = new URLSearchParams(params);
        if (active) {
            next.set('following', '1');
        }
        else {
            next.delete('following');
        }
        setParams(next);
    }

    return (
        <div className="following-filter">
            <label className="checkbox">
                <input type="checkbox" checked={active} onChange={(event) => update(event.target.checked)} />
                Only followed tasks
            </label>
            {active && <button type="button" className="text-button" onClick={() => update(false)}>Clear filter</button>}
        </div>
    );
}
